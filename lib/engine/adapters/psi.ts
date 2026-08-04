import { cached } from './cache'
import type { Adapter, AdapterContext, CollectResult } from './types'
import type { EvidenceInput } from '../../schemas'

/**
 * PageSpeed Insights: lab performance plus whatever field data exists.
 *
 * Young domains are usually below the CrUX popularity threshold, which returns
 * no field data. That absence is recorded as its own fact rather than as a
 * failure — "below CrUX threshold" is a true statement about a new property,
 * while "no performance data" would imply something went wrong.
 */

interface PsiResponse {
  lighthouseResult?: {
    categories?: Record<string, { score: number | null }>
    audits?: Record<string, { numericValue?: number }>
  }
  loadingExperience?: { metrics?: Record<string, unknown> }
}

async function fetchPsi(url: string): Promise<PsiResponse> {
  const endpoint =
    `https://www.googleapis.com/pagespeedonline/v5/runPagespeed` +
    `?url=${encodeURIComponent(url)}&strategy=mobile&category=performance&category=seo` +
    (process.env.PSI_API_KEY ? `&key=${process.env.PSI_API_KEY}` : '')
  const res = await fetch(endpoint)
  if (!res.ok) throw new Error(`psi ${res.status}`)
  return (await res.json()) as PsiResponse
}

export const psiAdapter: Adapter = {
  name: 'psi',

  unavailableReason(ctx) {
    // PSI cannot reach a site on localhost; the fixture property is scored by
    // the crawler alone, which is the honest outcome rather than a fake number.
    if (ctx.config.localSite) return 'local fixture site is not reachable by PageSpeed Insights'
    return null
  },

  async collect(ctx: AdapterContext): Promise<CollectResult> {
    const evidence: EvidenceInput[] = []
    const target = ctx.baseUrl

    try {
      const result = await cached('psi', target, ctx.mode, () => fetchPsi(target))
      await ctx.record({
        adapter: 'psi',
        requestKey: target,
        status: 'ok',
        cached: result.cached,
        latencyMs: result.latencyMs,
      })

      const categories = result.payload.lighthouseResult?.categories ?? {}
      const hasFieldData = Boolean(result.payload.loadingExperience?.metrics)

      evidence.push({
        kind: 'crawl_fact',
        source: 'psi',
        tier: 'measured',
        subject: target,
        value: {
          fact: 'page_speed_measured',
          url: target,
          detail: {
            performance: categories.performance?.score ?? null,
            seo: categories.seo?.score ?? null,
            lcpMs: result.payload.lighthouseResult?.audits?.['largest-contentful-paint']
              ?.numericValue ?? null,
            fieldData: hasFieldData ? 'available' : 'below_crux_popularity_threshold',
          },
        },
      })
    } catch (err) {
      ctx.log(`psi failed: ${err instanceof Error ? err.message : String(err)}`)
    }

    return { evidence }
  },
}
