import { cached } from './cache'
import type { Adapter, AdapterContext, ClusterInput, CollectResult } from './types'
import type { EvidenceInput } from '../../schemas'

/**
 * Google Autocomplete as a demand signal.
 *
 * Suggestions are real queries real people typed, which makes them the best
 * zero-cost demand evidence available. What they are not is search volume:
 * everything derived here is tagged `modeled`, and the confidence multiplier
 * for modeled evidence caps how far a keyword opportunity can outrank a
 * measured one. Production swaps this for a volume API behind the same
 * interface — the tier changes to `measured` and nothing else does.
 *
 * The endpoint is undocumented. That is stated rather than hidden, and it is
 * the reason every response is cached to a fixture on first use.
 */

const MODIFIERS = ['', 'best ', 'free ', 'how to ', 'vs ']

function classifyIntent(query: string): ClusterInput['intent'] {
  if (/\b(calculator|generator|checker|tool|converter|planner)\b/.test(query)) return 'tool_intent'
  if (/\b(best|top|vs|alternative|review|cheap|price|pricing)\b/.test(query)) return 'commercial'
  if (/\b(buy|download|install|sign ?up|free trial)\b/.test(query)) return 'transactional'
  if (/\b(how|what|why|when|guide|tips|ideas)\b/.test(query)) return 'informational'
  return 'commercial'
}

/**
 * Suggestion richness as a 0-10 demand proxy. Log-scaled, because the tenth
 * suggestion for a seed tells you far less than the second did.
 *
 * Calibrated against observed output: a seed with no suggestions scores 0, a
 * thin seed (~5) lands near 3.9, and a rich seed (~30) near 7.4. The ceiling is
 * deliberately out of reach — saturating every seed at 10 would make the demand
 * term useless for ranking, which is the failure this replaced.
 */
function demandFromSuggestions(count: number): number {
  if (count === 0) return 0
  return Math.min(10, Math.round(Math.log2(count + 1) * 1.5 * 10) / 10)
}

async function fetchSuggestions(seed: string, hl: string, gl: string): Promise<string[]> {
  const url =
    `https://suggestqueries.google.com/complete/search?client=firefox` +
    `&q=${encodeURIComponent(seed)}&hl=${hl}&gl=${gl}`
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`autocomplete ${res.status}`)
  const data = JSON.parse(await res.text()) as [string, string[]]
  return data[1] ?? []
}

export const autocompleteAdapter: Adapter = {
  name: 'autocomplete',

  unavailableReason(ctx) {
    return ctx.config.seedQueries.length === 0 ? 'no seedQueries configured' : null
  },

  async collect(ctx: AdapterContext): Promise<CollectResult> {
    const evidence: EvidenceInput[] = []
    const clusters: ClusterInput[] = []

    for (const { market, language } of ctx.config.markets) {
      for (const seed of ctx.config.seedQueries) {
        const suggestions = new Set<string>()

        for (const modifier of MODIFIERS) {
          const query = `${modifier}${seed}`
          const requestKey = `${query}|${language}|${market}`
          try {
            const result = await cached('autocomplete', requestKey, ctx.mode, () =>
              fetchSuggestions(query, language, market),
            )
            await ctx.record({
              adapter: 'autocomplete',
              requestKey,
              status: 'ok',
              cached: result.cached,
              latencyMs: result.latencyMs,
            })
            result.payload.forEach((s) => suggestions.add(s.toLowerCase()))
            if (!result.cached) await new Promise((r) => setTimeout(r, 600))
          } catch (err) {
            ctx.log(`autocomplete failed for "${query}": ${err instanceof Error ? err.message : err}`)
          }
        }

        const list = [...suggestions]
        const demand = demandFromSuggestions(list.length)

        evidence.push({
          kind: 'demand_signal',
          source: 'autocomplete',
          tier: 'modeled',
          subject: seed,
          value: {
            query: seed,
            market,
            suggestionCount: list.length,
            suggestions: list.slice(0, 25),
          },
        })

        clusters.push({
          market,
          query: seed,
          intent: classifyIntent(seed),
          demand,
          demandSource: 'modeled',
        })

        // The richest suggestions become clusters in their own right — this is
        // how the engine finds queries nobody typed into the config.
        for (const suggestion of list.slice(0, 4)) {
          if (suggestion === seed) continue
          clusters.push({
            market,
            query: suggestion,
            intent: classifyIntent(suggestion),
            demand: Math.max(0, demand - 2),
            demandSource: 'modeled',
          })
        }
      }
    }

    ctx.log(`${clusters.length} query clusters from ${ctx.config.seedQueries.length} seeds`)
    return { evidence, clusters }
  },
}
