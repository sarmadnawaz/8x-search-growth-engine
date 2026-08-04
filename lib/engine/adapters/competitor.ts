import { cached } from './cache'
import type { Adapter, AdapterContext, CollectResult } from './types'
import type { EvidenceInput } from '../../schemas'

/**
 * Competitor content profiling from public sitemaps.
 *
 * SERP sampling already tells us where competitors rank. This answers a
 * different question — what have they built that we have not? — by reading the
 * sitemap they publish for exactly this purpose and grouping their URLs by
 * section.
 *
 * It is the cheapest evidence in the system: one fetch per competitor, no API
 * key, and it produces the finding a portfolio operator actually acts on
 * ("they have 45 pages under /tools, we have none") rather than a per-keyword
 * position that says nothing about what to build.
 */

const USER_AGENT = 'SearchGrowthEngine/0.1 (+competitor sitemap profiling)'
const MAX_SITEMAP_URLS = 5000

interface SectionProfile {
  section: string
  count: number
  examples: string[]
}

async function fetchText(url: string): Promise<{ status: number; body: string }> {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, redirect: 'follow' })
  return { status: res.status, body: res.status < 400 ? await res.text() : '' }
}

function extractLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1])
}

/** Group URLs by their first path segment — the site's own sectioning. */
function profile(urls: string[]): SectionProfile[] {
  const sections = new Map<string, string[]>()

  for (const url of urls.slice(0, MAX_SITEMAP_URLS)) {
    try {
      const path = new URL(url).pathname
      const segment = path.split('/').filter(Boolean)[0] ?? '(root)'
      const list = sections.get(segment) ?? []
      if (list.length < 5) list.push(url)
      sections.set(segment, list)
    } catch {
      // a malformed <loc> is the competitor's problem, not a reason to fail
    }
  }

  const counts = new Map<string, number>()
  for (const url of urls.slice(0, MAX_SITEMAP_URLS)) {
    try {
      const segment = new URL(url).pathname.split('/').filter(Boolean)[0] ?? '(root)'
      counts.set(segment, (counts.get(segment) ?? 0) + 1)
    } catch {
      /* ignore */
    }
  }

  return [...counts.entries()]
    .map(([section, count]) => ({ section, count, examples: sections.get(section) ?? [] }))
    .sort((a, b) => b.count - a.count)
}

export const competitorAdapter: Adapter = {
  name: 'competitor',

  unavailableReason(ctx) {
    return ctx.config.competitors.length === 0 ? 'no competitors configured' : null
  },

  async collect(ctx: AdapterContext): Promise<CollectResult> {
    const evidence: EvidenceInput[] = []

    for (const competitor of ctx.config.competitors) {
      const origin = competitor.startsWith('http') ? competitor : `https://${competitor}`

      // Sitemaps move around, so follow robots.txt first and fall back to the
      // conventional location rather than assuming either.
      const candidates: string[] = []
      try {
        const robots = await cached(`competitor`, `${origin}/robots.txt`, ctx.mode, () =>
          fetchText(`${origin}/robots.txt`),
        )
        await ctx.record({
          adapter: 'competitor',
          requestKey: `${origin}/robots.txt`,
          status: String(robots.payload.status),
          cached: robots.cached,
          latencyMs: robots.latencyMs,
        })
        candidates.push(
          ...[...robots.payload.body.matchAll(/sitemap:\s*(\S+)/gi)].map((m) => m[1]),
        )
      } catch (err) {
        ctx.log(`${competitor}: robots.txt unavailable (${err instanceof Error ? err.message : err})`)
      }
      candidates.push(`${origin}/sitemap.xml`)

      let urls: string[] = []
      for (const candidate of candidates.slice(0, 3)) {
        try {
          const result = await cached('competitor', candidate, ctx.mode, () => fetchText(candidate))
          await ctx.record({
            adapter: 'competitor',
            requestKey: candidate,
            status: String(result.payload.status),
            cached: result.cached,
            latencyMs: result.latencyMs,
          })
          if (result.payload.status !== 200) continue

          const locs = extractLocs(result.payload.body)
          // A sitemap index points at more sitemaps; follow one level only —
          // this is profiling, not a crawl of someone else's site.
          const nested = locs.filter((l) => l.endsWith('.xml'))
          if (nested.length > 0 && locs.length === nested.length) {
            for (const child of nested.slice(0, 3)) {
              const sub = await cached('competitor', child, ctx.mode, () => fetchText(child))
              await ctx.record({
                adapter: 'competitor',
                requestKey: child,
                status: String(sub.payload.status),
                cached: sub.cached,
                latencyMs: sub.latencyMs,
              })
              urls.push(...extractLocs(sub.payload.body))
            }
          } else {
            urls.push(...locs)
          }
          if (urls.length > 0) break
        } catch (err) {
          ctx.log(`${competitor}: ${candidate} unavailable`)
        }
      }

      if (urls.length === 0) {
        // Recorded rather than skipped: "we could not read their sitemap" is a
        // different statement from "they have no content", and the detector
        // must not confuse them.
        evidence.push({
          kind: 'competitor_fact',
          source: 'competitor',
          tier: 'measured',
          subject: competitor,
          value: { competitor, fact: 'sitemap_unreadable', sections: [], totalUrls: 0 },
        })
        ctx.log(`${competitor}: no readable sitemap`)
        continue
      }

      const sections = profile(urls)
      evidence.push({
        kind: 'competitor_fact',
        source: 'competitor',
        tier: 'measured',
        subject: competitor,
        value: {
          competitor,
          fact: 'sitemap_profile',
          totalUrls: urls.length,
          sections: sections.slice(0, 15),
        },
      })
      ctx.log(`${competitor}: ${urls.length} URLs across ${sections.length} sections`)
    }

    return { evidence }
  },
}
