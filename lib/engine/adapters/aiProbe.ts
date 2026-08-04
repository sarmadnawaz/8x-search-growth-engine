import { cached } from './cache'
import { getProvider } from '../llm'
import { wilsonLowerBound } from '../scoring'
import type { Adapter, AdapterContext, CollectResult } from './types'
import type { EvidenceInput } from '../../schemas'

/**
 * AI-visibility probe: does an answer engine mention or cite this property
 * when asked the questions its buyers actually ask?
 *
 * Three design decisions worth stating, because each is a way this measurement
 * is usually done wrong:
 *
 *  1. Grounding is mandatory. Every 8x property launched after any model's
 *     training cutoff, so an ungrounded model cannot cite them regardless of
 *     how well they perform. An ungrounded probe would report a permanent zero
 *     and look like a working metric.
 *
 *  2. Answers are non-deterministic, so a single response is not a
 *     measurement. Each prompt is sampled N times and reported as an inclusion
 *     *rate* with a Wilson lower bound, which then discounts confidence in
 *     scoring — an n=3 probe should not carry the weight of an HTTP status.
 *
 *  3. Bare brand-string matching produces false positives for names that
 *     collide with bigger entities (Luma, Sway). Properties flagged with
 *     `entityCollision` require the domain or a brand+category co-occurrence.
 */

const SAMPLES_PER_PROMPT = 3

export function mentions(text: string, citations: string[], config: {
  domain: string
  name: string
  entityCollision: boolean
  description: string
}): boolean {
  const haystack = `${text}\n${citations.join('\n')}`.toLowerCase()
  const domain = config.domain.toLowerCase()
  const brand = config.name.toLowerCase().split(':')[0].trim()

  if (haystack.includes(domain)) return true
  if (!config.entityCollision) return haystack.includes(brand)

  // Collision-prone brand: require the brand near a category word from the
  // property's own description, so "Sway" the Microsoft product does not count
  // as a mention of a stretching app.
  if (!haystack.includes(brand)) return false
  const categoryWords = config.description
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 4)
  return categoryWords.some((word) => haystack.includes(word))
}

export const aiProbeAdapter: Adapter = {
  name: 'ai_probe',

  unavailableReason(ctx) {
    if (ctx.config.promptPanel.length === 0) return 'no promptPanel configured'
    if (ctx.mode === 'live') {
      const provider = getProvider()
      const reason = provider.unavailableReason()
      if (reason) return reason
      // Grounding is a requirement, not a preference. Without live search the
      // model answers from training data that predates every property here, so
      // the probe would report a permanent zero that looks like a measurement.
      // Refusing is the honest outcome.
      if (!provider.supportsGrounding()) {
        return `${provider.name} cannot ground answers in live search — an ungrounded probe measures training data, not visibility`
      }
    }
    return null
  },

  async collect(ctx: AdapterContext): Promise<CollectResult> {
    const provider = getProvider()
    const evidence: EvidenceInput[] = []

    for (const prompt of ctx.config.promptPanel) {
      let mentionCount = 0
      let samples = 0
      const citedUrls = new Set<string>()
      let model = provider.name

      for (let i = 0; i < SAMPLES_PER_PROMPT; i++) {
        // The sample index is part of the cache key: replaying a probe must
        // reproduce the same distribution, not the same single answer.
        const requestKey = `${prompt}|${ctx.config.domain}|sample${i}`
        try {
          const result = await cached('ai_probe', requestKey, ctx.mode, () =>
            provider.answerGrounded(prompt),
          )
          await ctx.record({
            adapter: 'ai_probe',
            requestKey,
            status: 'ok',
            cached: result.cached,
            latencyMs: result.latencyMs,
          })

          samples++
          model = result.payload.model
          result.payload.citations.forEach((url) => citedUrls.add(url))
          if (mentions(result.payload.text, result.payload.citations, ctx.config)) {
            mentionCount++
          }
        } catch (err) {
          ctx.log(`probe failed for "${prompt}" sample ${i}: ${err instanceof Error ? err.message : err}`)
        }
      }

      if (samples === 0) continue

      const ownCitations = [...citedUrls].filter((url) => url.includes(ctx.config.domain))

      evidence.push({
        kind: 'ai_answer_probe',
        source: `ai_probe:${model}`,
        tier: 'measured',
        subject: prompt,
        value: {
          prompt,
          engine: model,
          samples,
          mentions: mentionCount,
          citedUrls: [...citedUrls].slice(0, 20),
          ownCitations,
          inclusionLowerBound: wilsonLowerBound(mentionCount, samples),
        },
      })

      ctx.log(`"${prompt.slice(0, 48)}" — mentioned in ${mentionCount}/${samples} samples`)
    }

    return { evidence }
  },
}
