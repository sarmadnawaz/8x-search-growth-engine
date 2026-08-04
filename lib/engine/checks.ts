import { prisma } from '../db'

/**
 * The check vocabulary: every acceptance criterion an action can carry, and how
 * each one is settled.
 *
 * Criteria fall into two classes, and conflating them is the mistake this file
 * exists to prevent:
 *
 *   DELIVERY  — "did the work ship?" Settled by fetching the page now. Binary,
 *               fast, and the only class that may move an action to `verified`.
 *
 *   OUTCOME   — "did it pay off?" Settled against evidence collected over time,
 *               not by a fetch. Rankings take 2-6 months to move, so folding
 *               these into the done/not-done decision would make a fix that
 *               shipped perfectly look like a failure for a quarter.
 *
 * Both classes are evaluated on every pass. Outcome checks additionally carry a
 * measurement window and a verdict, which is what turns "we shipped it" into
 * "it worked" — or into "stop doing this".
 */

export type CheckClass = 'delivery' | 'outcome'

export interface CheckOutcome {
  passed: boolean
  observed: string
  /** outcome checks only: how the metric is trending inside its window */
  verdict?: 'improving' | 'flat' | 'declining' | 'too_early'
  /** outcome checks only: the numbers behind the verdict */
  baseline?: number
  current?: number
  metric?: string
}

export interface CheckContext {
  domain: string
  baseUrl: string
  /** how long an outcome needs before a verdict is anything but too_early */
  windowDays: number
  fetchPath: (path: string) => Promise<{ status: number; body: string }>
}

/** Which class a check expression belongs to, derived from its verb. */
const OUTCOME_CHECKS = new Set([
  'rank_within',
  'snippet_owner',
  'probe_inclusion',
  'indexed_pages_min',
])

export function classOf(check: string): CheckClass {
  return OUTCOME_CHECKS.has(check.split(':')[0]) ? 'outcome' : 'delivery'
}

// ---------------------------------------------------------------------------
// Delivery checks — settled by fetching the page as it is right now.
// ---------------------------------------------------------------------------

const DELIVERY: Record<string, (rest: string, ctx: CheckContext) => Promise<CheckOutcome>> = {
  async http_status(rest, ctx) {
    const [path, expected] = rest.split('=')
    const res = await ctx.fetchPath(path)
    return { passed: res.status === Number(expected), observed: `HTTP ${res.status}` }
  },

  async body_contains(rest, ctx) {
    const [path, needle] = rest.split('=')
    const res = await ctx.fetchPath(path)
    const passed = res.status === 200 && res.body.toLowerCase().includes(needle.toLowerCase())
    if (res.status !== 200) return { passed: false, observed: `HTTP ${res.status}` }
    return { passed, observed: passed ? `contains "${needle}"` : `missing "${needle}"` }
  },

  async min_text_length(rest, ctx) {
    const [path, min] = rest.split('=')
    const res = await ctx.fetchPath(path)
    const text = stripTags(res.body)
    return {
      passed: text.length >= Number(min),
      observed: `${text.length} chars of initial-HTML text`,
    }
  },

  async page_indexable(rest, ctx) {
    const path = rest || '/'
    const res = await ctx.fetchPath(path)
    const noindex = /<meta[^>]+name=["']robots["'][^>]+noindex/i.test(res.body)
    return {
      passed: res.status === 200 && !noindex,
      observed: `HTTP ${res.status}${noindex ? ', noindex present' : ''}`,
    }
  },

  async crawl_fact_absent(rest, ctx) {
    const [fact, path] = rest.split('@')
    const res = await ctx.fetchPath(path ?? '/')
    if (res.status !== 200) return { passed: false, observed: `HTTP ${res.status}` }

    const stillPresent: Record<string, boolean> = {
      canonical_missing: !/<link[^>]+rel=["']canonical["']/i.test(res.body),
      meta_description_missing: !/<meta[^>]+name=["']description["']/i.test(res.body),
      title_missing: !/<title>[^<]+<\/title>/i.test(res.body),
      h1_missing: !/<h1[\s>]/i.test(res.body),
      schema_missing: !/application\/ld\+json/i.test(res.body),
      thin_initial_html: stripTags(res.body).length < 500,
    }
    const present = stillPresent[fact]
    if (present === undefined) return { passed: false, observed: `unknown fact "${fact}"` }
    return { passed: !present, observed: present ? `${fact} still present` : `${fact} resolved` }
  },

  /**
   * Sourced statistics: a number next to a citation. This is the one content
   * property with controlled evidence behind it (Princeton GEO, KDD 2024), so
   * it earns a machine check rather than a reviewer's opinion.
   */
  async sourced_stats(rest, ctx) {
    const required = Number(rest.split('=')[1] ?? rest) || 3
    const res = await ctx.fetchPath('/')
    if (res.status !== 200) return { passed: false, observed: `HTTP ${res.status}` }

    const text = stripTags(res.body)
    const figures = text.match(/\b\d+(\.\d+)?\s?(%|percent|x|million|billion|k\b)/gi) ?? []
    const citations = (res.body.match(/<a[^>]+href=["']https?:\/\/(?!.*(?:localhost|127\.0))/gi) ?? [])
      .length

    // A statistic without a source is an assertion; a source without a figure
    // is a link. The check wants both present.
    const stats = Math.min(figures.length, citations)
    return {
      passed: stats >= required,
      observed: `${figures.length} figures, ${citations} outbound citations`,
    }
  },

  /** Answer-first formatting: a question heading followed by a short answer. */
  async answer_block_present(_rest, ctx) {
    const res = await ctx.fetchPath('/')
    if (res.status !== 200) return { passed: false, observed: `HTTP ${res.status}` }

    const headings = [...res.body.matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi)]
    for (const heading of headings) {
      const title = stripTags(heading[1])
      if (!/^(what|how|why|when|which|who|is|are|can|does|do)\b/i.test(title)) continue

      const after = stripTags(res.body.slice((heading.index ?? 0) + heading[0].length, (heading.index ?? 0) + heading[0].length + 1200))
      const words = after.split(/\s+/).filter(Boolean).length
      if (words >= 30) {
        return { passed: true, observed: `question heading "${title.slice(0, 40)}" followed by an answer` }
      }
    }
    return {
      passed: false,
      observed: headings.length
        ? `${headings.length} headings, none question-shaped with an answer`
        : 'no h2/h3 headings',
    }
  },

  /** A specific schema.org type is present and parses. */
  async schema_type_present(rest, ctx) {
    const wanted = rest.split('=')[1] ?? rest
    const res = await ctx.fetchPath('/')
    if (res.status !== 200) return { passed: false, observed: `HTTP ${res.status}` }

    const blocks = [...res.body.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)]
    const types: string[] = []
    for (const block of blocks) {
      try {
        const parsed = JSON.parse(block[1])
        for (const node of Array.isArray(parsed) ? parsed : [parsed]) {
          if (node?.['@type']) types.push(...[node['@type']].flat().map(String))
        }
      } catch {
        // invalid JSON-LD counts as absent, which is what a consumer sees too
      }
    }
    return {
      passed: types.some((t) => t.toLowerCase() === wanted.toLowerCase()),
      observed: types.length ? `schema types: ${[...new Set(types)].join(', ')}` : 'no valid JSON-LD',
    }
  },

  async internal_links_min(rest, ctx) {
    const required = Number(rest.split('=')[1] ?? rest) || 3
    const res = await ctx.fetchPath('/')
    if (res.status !== 200) return { passed: false, observed: `HTTP ${res.status}` }
    const links = (res.body.match(/<a[^>]+href=["'](\/|https?:\/\/[^"']*)/gi) ?? []).length
    return { passed: links >= required, observed: `${links} links found` }
  },
}

// ---------------------------------------------------------------------------
// Outcome checks — settled against evidence collected over time.
//
// These read the snapshot series rather than the live page, because the thing
// being asked ("are we ranking yet?") is not visible in a single fetch of our
// own site.
// ---------------------------------------------------------------------------

/** Days since the action shipped, which decides whether a verdict is credible. */
function verdictFor(
  baseline: number | null,
  current: number | null,
  daysElapsed: number,
  windowDays: number,
  higherIsBetter = true,
): CheckOutcome['verdict'] {
  if (baseline === null || current === null) return 'too_early'
  if (daysElapsed < windowDays) return 'too_early'
  const delta = higherIsBetter ? current - baseline : baseline - current
  if (delta > 0) return 'improving'
  if (delta < 0) return 'declining'
  return 'flat'
}

const OUTCOME: Record<
  string,
  (rest: string, ctx: CheckContext, daysElapsed: number) => Promise<CheckOutcome>
> = {
  /** Are we inside the target position for this query yet? */
  async rank_within(rest, ctx, daysElapsed) {
    const [query, target] = rest.split('=')
    const series = await positionSeries(ctx.domain, query)
    const baseline = series.at(0) ?? null
    const current = series.at(-1) ?? null

    return {
      // A missing ranking is not a pass, but nor is it a failure of delivery —
      // the action shipped; the market has not answered yet.
      passed: current !== null && current <= Number(target),
      observed:
        current === null
          ? `not ranking for "${query}" (${series.length} observations)`
          : `position ${current} (from ${baseline ?? 'unranked'}), target top ${target}`,
      // rank is better when lower, so invert
      verdict: verdictFor(baseline, current, daysElapsed, ctx.windowDays, false),
      baseline: baseline ?? undefined,
      current: current ?? undefined,
      metric: `rank:${query}`,
    }
  },

  async snippet_owner(rest, ctx, daysElapsed) {
    const query = rest.split('=')[0]
    const rows = await serpRows(ctx.domain, query)
    const latest = rows.at(-1)
    const owns = Boolean(
      latest?.topResults?.[0]?.url?.includes(ctx.domain) &&
        latest?.serpFeatures?.includes('featured_snippet'),
    )
    return {
      passed: owns,
      observed: latest
        ? owns
          ? 'we own the snippet'
          : `snippet present: ${latest.serpFeatures.includes('featured_snippet')}, top result is not ours`
        : 'no SERP observation for this query',
      verdict: verdictFor(0, owns ? 1 : 0, daysElapsed, ctx.windowDays),
      metric: `snippet:${query}`,
    }
  },

  /** Are answer engines mentioning us yet, and at what rate? */
  async probe_inclusion(rest, ctx, daysElapsed) {
    const [prompt, target] = rest.split('=')
    const rows = await prisma.evidence.findMany({
      where: { domain: ctx.domain, kind: 'ai_answer_probe', subject: prompt },
      orderBy: { fetchedAt: 'asc' },
    })
    const rates = rows.map((r) => {
      const v = r.value as { mentions: number; samples: number }
      return v.samples > 0 ? v.mentions / v.samples : 0
    })
    const baseline = rates.at(0) ?? null
    const current = rates.at(-1) ?? null

    return {
      passed: current !== null && current >= Number(target),
      observed:
        current === null
          ? 'no probe evidence yet'
          : `mentioned in ${(current * 100).toFixed(0)}% of samples (target ${(Number(target) * 100).toFixed(0)}%)`,
      verdict: verdictFor(baseline, current, daysElapsed, ctx.windowDays),
      baseline: baseline ?? undefined,
      current: current ?? undefined,
      metric: `ai_inclusion:${prompt}`,
    }
  },

  /** Discovery outcome: is the site actually being indexed? */
  async indexed_pages_min(rest, ctx, daysElapsed) {
    const required = Number(rest.split('=')[1] ?? rest) || 1
    const snapshots = await prisma.snapshot.findMany({
      where: { domain: ctx.domain, status: { not: 'pending' } },
      orderBy: { startedAt: 'asc' },
      select: { id: true },
    })
    const counts = await Promise.all(
      snapshots.map((s) => prisma.page.count({ where: { snapshotId: s.id, indexable: true } })),
    )
    const baseline = counts.at(0) ?? null
    const current = counts.at(-1) ?? null

    return {
      passed: (current ?? 0) >= required,
      observed: `${current ?? 0} indexable pages (from ${baseline ?? 0})`,
      verdict: verdictFor(baseline, current, daysElapsed, ctx.windowDays),
      baseline: baseline ?? undefined,
      current: current ?? undefined,
      metric: 'indexable_pages',
    }
  },
}

interface SerpValue {
  query: string
  ownPosition: number | null
  topResults: { position: number; url: string; title: string }[]
  serpFeatures: string[]
}

async function serpRows(domain: string, query: string): Promise<SerpValue[]> {
  const rows = await prisma.evidence.findMany({
    where: { domain, kind: 'serp_observation', subject: query },
    orderBy: { fetchedAt: 'asc' },
  })
  return rows.map((r) => r.value as unknown as SerpValue)
}

async function positionSeries(domain: string, query: string): Promise<number[]> {
  return (await serpRows(domain, query))
    .map((v) => v.ownPosition)
    .filter((p): p is number => p !== null)
}

/**
 * Evaluate one criterion. Unknown verbs fail loudly rather than silently
 * passing — an unimplemented check that reports "not applicable" is how a
 * system starts lying about what it has verified.
 */
export async function evaluateCheck(
  check: string,
  ctx: CheckContext,
  daysElapsed: number,
): Promise<CheckOutcome> {
  const [kind, ...restParts] = check.split(':')
  const rest = restParts.join(':')

  if (DELIVERY[kind]) return DELIVERY[kind](rest, ctx)
  if (OUTCOME[kind]) return OUTCOME[kind](rest, ctx, daysElapsed)

  return { passed: false, observed: `unsupported check "${kind}" — not evaluated` }
}

export const SUPPORTED_CHECKS = [...Object.keys(DELIVERY), ...Object.keys(OUTCOME)].sort()

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
