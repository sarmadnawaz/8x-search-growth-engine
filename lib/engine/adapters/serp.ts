import { cached } from './cache'
import type { Adapter, AdapterContext, CollectResult } from './types'
import type { EvidenceInput } from '../../schemas'

/**
 * SERP sampling via serper.dev.
 *
 * Budget is a config knob, not a constant: queries-per-property-per-run is what
 * the production cost model keys on, so it is capped here and reported.
 *
 * One deliberate distinction: `aiOverviewPresent` is `null` when we could not
 * observe it, and `false` only when we observed its absence. AI Overviews are
 * not reliably served to scraping backends, so conflating "not served to this
 * client" with "no AI Overview exists" would manufacture evidence.
 */

const MAX_QUERIES_PER_RUN = 30

interface SerperOrganic {
  position: number
  link: string
  title: string
}

interface SerperResponse {
  organic?: SerperOrganic[]
  peopleAlsoAsk?: { question: string }[]
  answerBox?: unknown
  aiOverview?: unknown
}

async function fetchSerp(query: string, gl: string, hl: string): Promise<SerperResponse> {
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': process.env.SERPER_API_KEY ?? '',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ q: query, gl, hl, num: 10 }),
  })
  if (!res.ok) throw new Error(`serper ${res.status}`)
  return (await res.json()) as SerperResponse
}

export const serpAdapter: Adapter = {
  name: 'serp',

  unavailableReason(ctx) {
    if (ctx.clusters.length === 0) return 'no query clusters to sample'
    if (ctx.mode === 'live' && !process.env.SERPER_API_KEY) return 'SERPER_API_KEY not set'
    return null
  },

  async collect(ctx: AdapterContext): Promise<CollectResult> {
    const evidence: EvidenceInput[] = []

    // Highest-demand clusters first: the budget should buy the most informative
    // observations, not the alphabetically earliest ones.
    const targets = [...ctx.clusters]
      .sort((a, b) => b.demand - a.demand)
      .slice(0, MAX_QUERIES_PER_RUN)

    for (const cluster of targets) {
      const language =
        ctx.config.markets.find((m) => m.market === cluster.market)?.language ?? 'en'
      const requestKey = `${cluster.query}|${cluster.market}|${language}`

      try {
        const result = await cached('serp', requestKey, ctx.mode, () =>
          fetchSerp(cluster.query, cluster.market, language),
        )
        await ctx.record({
          adapter: 'serp',
          requestKey,
          status: 'ok',
          cached: result.cached,
          latencyMs: result.latencyMs,
        })

        const organic = result.payload.organic ?? []
        const own = organic.find((r) => {
          try {
            return new URL(r.link).hostname.replace(/^www\./, '').endsWith(ctx.config.domain)
          } catch {
            return false
          }
        })

        const features: string[] = []
        if (result.payload.answerBox) features.push('featured_snippet')
        if (result.payload.peopleAlsoAsk?.length) features.push('people_also_ask')
        if (result.payload.aiOverview) features.push('ai_overview')

        evidence.push({
          kind: 'serp_observation',
          source: 'serp',
          tier: 'measured',
          subject: cluster.query,
          value: {
            query: cluster.query,
            market: cluster.market,
            ownPosition: own?.position ?? null,
            topResults: organic.slice(0, 10).map((r) => ({
              position: r.position,
              url: r.link,
              title: r.title,
            })),
            serpFeatures: features,
            // this client does not reliably receive AI Overview blocks;
            // record "unobserved" rather than "absent"
            aiOverviewPresent: result.payload.aiOverview ? true : null,
          },
        })

        // Competitor presence is derived from the same fetch — no extra spend.
        for (const competitor of ctx.config.competitors) {
          const hit = organic.find((r) => r.link.includes(competitor))
          if (hit) {
            evidence.push({
              kind: 'competitor_fact',
              source: 'serp',
              tier: 'measured',
              subject: competitor,
              value: {
                query: cluster.query,
                market: cluster.market,
                competitor,
                position: hit.position,
                url: hit.link,
              },
            })
          }
        }

        if (!result.cached) await new Promise((r) => setTimeout(r, 400))
      } catch (err) {
        ctx.log(`serp failed for "${cluster.query}": ${err instanceof Error ? err.message : err}`)
      }
    }

    ctx.log(`sampled ${targets.length} SERPs (cap ${MAX_QUERIES_PER_RUN}/run)`)
    return { evidence }
  },
}
