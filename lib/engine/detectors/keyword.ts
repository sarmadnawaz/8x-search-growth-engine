import type { Detector, DetectorInput } from './types'
import { value } from './types'
import type { OpportunityDraft } from '../../schemas'
import { headroom } from '../scoring'

interface SerpValue {
  query: string
  market: string
  ownPosition: number | null
  topResults: { position: number; url: string; title: string }[]
  serpFeatures: string[]
  aiOverviewPresent: boolean | null
}

/**
 * Where a property could realistically rank.
 *
 * A domain launched weeks ago will not take position 1 from an established
 * competitor, so achievable position is inferred from what the SERP actually
 * looks like rather than assumed to be the top. A result set thick with
 * community/UGC pages is a weak SERP and genuinely winnable; one filled with
 * established brands is not.
 */
function achievablePosition(serp: SerpValue): number {
  const weakSignals = serp.topResults.filter((r) =>
    /reddit\.com|quora\.com|medium\.com|pinterest\./.test(r.url),
  ).length
  if (weakSignals >= 3) return 3
  if (weakSignals >= 1) return 5
  return 8
}

/**
 * Two mechanical filters, both from the same SERP fetch:
 *   - we are absent or ranking poorly for a query with demand
 *   - a featured snippet exists, we are on page one, and someone else owns it
 */
export const keywordGapDetector: Detector = {
  id: 'keyword-serp-gap',
  version: '1.0.0',
  description:
    'Finds demand-backed queries where the property is absent or below its achievable position.',

  run({ evidence, clusters }: DetectorInput): OpportunityDraft[] {
    const serpRows = evidence.filter((e) => e.kind === 'serp_observation')
    const demandRows = evidence.filter((e) => e.kind === 'demand_signal')
    const drafts: OpportunityDraft[] = []

    for (const row of serpRows) {
      const serp = value<SerpValue>(row)
      const cluster = clusters.find((c) => c.query === serp.query && c.market === serp.market)
      if (!cluster || cluster.demand <= 0) continue

      const target = achievablePosition(serp)
      const gap = headroom(serp.ownPosition, target)
      if (gap <= 0) continue

      // Demand is modeled unless a volume source measured it; the weaker datum
      // sets the tier for the whole opportunity.
      const demandRow = demandRows.find((d) => value<{ query: string }>(d).query === serp.query)
      const weakestTier = cluster.demandSource === 'measured' ? 'measured' : 'modeled'

      const competitorsAbove = serp.topResults.filter(
        (r) => serp.ownPosition === null || r.position < serp.ownPosition,
      )

      drafts.push({
        type: 'keyword',
        detectorId: keywordGapDetector.id,
        detectorVersion: keywordGapDetector.version,
        title:
          serp.ownPosition === null
            ? `Not ranking for "${serp.query}" (${serp.market})`
            : `Ranking #${serp.ownPosition} for "${serp.query}" — achievable #${target}`,
        subject: serp.query,
        evidenceIds: [row.id, ...(demandRow ? [demandRow.id] : [])],
        isBlocker: false,
        impactInputs: {
          demand: cluster.demand,
          headroom: gap,
          coverage: 0,
          severity: 0,
          citationHeadroom: 0,
          aiOverviewPresent: serp.aiOverviewPresent === true,
        },
        intent: cluster.intent as OpportunityDraft['intent'],
        effortClass: cluster.intent === 'tool_intent' ? 'free_tool' : 'new_page',
        weakestTier,
        sourceCount: demandRow ? 2 : 1,
        sampleDiscount: 1,
        suggestedAction: {
          kind: cluster.intent === 'tool_intent' ? 'build_free_tool' : 'publish_landing_page',
          title:
            cluster.intent === 'tool_intent'
              ? `Build a utility that answers "${serp.query}"`
              : `Publish a page targeting "${serp.query}"`,
          spec:
            `Query: "${serp.query}" (${serp.market}, intent: ${cluster.intent}). ` +
            `Currently ${serp.ownPosition ? `#${serp.ownPosition}` : 'absent'}; achievable #${target} ` +
            `based on SERP composition. Pages to beat: ` +
            competitorsAbove
              .slice(0, 3)
              .map((r) => `#${r.position} ${r.url}`)
              .join(', ') +
            '.',
          criteria: [
            {
              id: 'page_live',
              description: 'Target page returns 200 and is indexable',
              check: 'page_indexable',
            },
            {
              id: 'answer_block',
              description: 'Page opens with a question heading and a direct answer',
              check: 'answer_block_present',
            },
            {
              id: 'internal_links',
              description: 'Page is linked into the site, not orphaned',
              check: 'internal_links_min:3',
            },
            {
              id: 'ranking_progress',
              description: `Enters top ${target * 2} for the query within the measurement window`,
              check: `rank_within:${serp.query}=${target * 2}`,
            },
          ],
        },
      })
    }

    return drafts
  },
}

/** Snippet-steal: the cheapest fully-closed detect -> act -> verify loop there is. */
export const snippetDetector: Detector = {
  id: 'featured-snippet-gap',
  version: '1.0.0',
  description: 'Finds queries with a featured snippet the property ranks near but does not own.',

  run({ evidence, clusters }: DetectorInput): OpportunityDraft[] {
    const drafts: OpportunityDraft[] = []

    for (const row of evidence.filter((e) => e.kind === 'serp_observation')) {
      const serp = value<SerpValue>(row)
      if (!serp.serpFeatures.includes('featured_snippet')) continue
      if (serp.ownPosition === null || serp.ownPosition > 10) continue

      const cluster = clusters.find((c) => c.query === serp.query && c.market === serp.market)

      drafts.push({
        type: 'content',
        detectorId: snippetDetector.id,
        detectorVersion: snippetDetector.version,
        title: `Featured snippet for "${serp.query}" is owned by a competitor`,
        subject: serp.query,
        evidenceIds: [row.id],
        isBlocker: false,
        impactInputs: {
          demand: cluster?.demand ?? 5,
          headroom: 0.6,
          coverage: 0,
          severity: 0,
          citationHeadroom: 0,
          aiOverviewPresent: serp.aiOverviewPresent === true,
        },
        intent: (cluster?.intent as OpportunityDraft['intent']) ?? 'informational',
        effortClass: 'page_edit',
        weakestTier: 'measured',
        sourceCount: 1,
        sampleDiscount: 1,
        suggestedAction: {
          kind: 'restructure_for_snippet',
          title: `Restructure the ranking page to win the "${serp.query}" snippet`,
          spec:
            'Add a question-matching h2 followed by a 40-60 word direct answer, and put ' +
            'comparison data in a real HTML table. Answer-first formatting is the consistent ' +
            'correlate of snippet and AI-answer capture.',
          criteria: [
            {
              id: 'answer_block',
              description: 'Page contains a 40-60 word answer paragraph under a question heading',
              check: 'answer_block_present',
            },
            {
              id: 'snippet_owned',
              description: 'Property owns the featured snippet for the query',
              check: `snippet_owner:${serp.query}`,
            },
          ],
        },
      })
    }

    return drafts
  },
}
