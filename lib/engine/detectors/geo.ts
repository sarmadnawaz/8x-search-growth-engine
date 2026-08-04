import type { Detector, DetectorInput } from './types'
import { value } from './types'
import type { OpportunityDraft } from '../../schemas'

interface ProbeValue {
  prompt: string
  engine: string
  samples: number
  mentions: number
  citedUrls: string[]
  ownCitations: string[]
  inclusionLowerBound: number
}

/**
 * Answer-engine visibility gaps.
 *
 * Scored on citation headroom rather than a click-through curve: there is no
 * SERP position to gain when the question is "does the answer mention us at
 * all", so borrowing the keyword formula here would produce a number that
 * looks meaningful and is not.
 *
 * The recommended asset follows the one controlled experiment in this area
 * (Princeton/IIT, KDD 2024): sourced statistics, quotable lines and citations
 * lifted generative-engine visibility 30-40%, while keyword stuffing did
 * nothing. Where a third-party page is repeatedly cited instead of us, the
 * play is placement in that page rather than another page of our own.
 */
export const aiCitationDetector: Detector = {
  id: 'ai-citation-gap',
  version: '1.0.0',
  description:
    'Finds buyer-intent prompts where answer engines do not mention or cite the property, and identifies which sources they cite instead.',

  run({ config, evidence }: DetectorInput): OpportunityDraft[] {
    const probes = evidence.filter((e) => e.kind === 'ai_answer_probe')
    if (probes.length === 0) return []

    const drafts: OpportunityDraft[] = []

    // Which third-party sources does the engine keep citing for our prompts?
    // These are the pages to earn a place in, and the count is evidence.
    const sourceFrequency = new Map<string, number>()
    for (const row of probes) {
      const probe = value<ProbeValue>(row)
      for (const url of probe.citedUrls) {
        try {
          const host = new URL(url).hostname.replace(/^www\./, '')
          if (host.includes(config.domain)) continue
          sourceFrequency.set(host, (sourceFrequency.get(host) ?? 0) + 1)
        } catch {
          // a malformed citation URL is not worth failing a detector over
        }
      }
    }
    const recurringSources = [...sourceFrequency.entries()]
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)

    for (const row of probes) {
      const probe = value<ProbeValue>(row)
      const inclusionRate = probe.samples > 0 ? probe.mentions / probe.samples : 0
      if (inclusionRate >= 1) continue // already cited in every sample

      const citationHeadroom = 1 - inclusionRate
      const isBrandPrompt = probe.prompt.toLowerCase().includes(config.name.toLowerCase().split(':')[0].trim())

      drafts.push({
        type: 'geo_aeo',
        detectorId: aiCitationDetector.id,
        detectorVersion: aiCitationDetector.version,
        title: isBrandPrompt
          ? `Answer engines describe "${config.name}" without citing us (${probe.mentions}/${probe.samples} samples)`
          : `Absent from AI answers for "${probe.prompt}" (${probe.mentions}/${probe.samples} samples)`,
        subject: probe.prompt,
        evidenceIds: [row.id],
        isBlocker: false,
        impactInputs: {
          // Buyer-intent prompts from config are demand by definition; a brand
          // prompt is worth more because a wrong answer about our own product
          // is a correctness problem, not just a visibility one.
          demand: isBrandPrompt ? 8 : 6,
          headroom: 0,
          coverage: 0,
          severity: 0,
          citationHeadroom,
          aiOverviewPresent: false,
        },
        intent: isBrandPrompt ? 'navigational' : 'commercial',
        effortClass: isBrandPrompt ? 'page_edit' : 'data_page',
        weakestTier: 'measured',
        sourceCount: 1,
        // A three-sample probe is not a certainty, and the score should know it.
        sampleDiscount: Math.max(0.4, probe.inclusionLowerBound > 0 ? 1 : 0.6),
        suggestedAction: isBrandPrompt
          ? {
              kind: 'own_brand_answer',
              title: `Publish an unambiguous answer page for "${config.name}"`,
              spec:
                `Answer engines are answering questions about our own product from other people's ` +
                `pages. Publish a server-rendered page stating what ${config.name} is, what it costs, ` +
                `and who it is for, in plain sentences a retrieval system can quote. ` +
                (recurringSources.length
                  ? `Currently cited instead: ${recurringSources.map(([h]) => h).join(', ')}.`
                  : ''),
              criteria: [
                {
                  id: 'answer_page_live',
                  description: 'A server-rendered page answering the brand question returns 200',
                  check: 'page_indexable',
                },
                {
                  id: 'brand_answer_cited',
                  description: 'Property is mentioned in a majority of probe samples',
                  check: `probe_inclusion:${probe.prompt}=0.5`,
                },
              ],
            }
          : {
              kind: 'geo_retrofit',
              title: `Earn citations for "${probe.prompt}"`,
              spec:
                `Answer engines cite ${recurringSources.length ? recurringSources.map(([h, c]) => `${h} (${c}x)`).join(', ') : 'other sources'} ` +
                `for this prompt and do not mention us. Two moves, in order: publish a page with ` +
                `original sourced statistics and quotable lines answering this question directly ` +
                `(the tactic with controlled evidence behind it), and pursue inclusion in the ` +
                `recurring third-party sources above, which is a distribution play rather than a ` +
                `content one.`,
              criteria: [
                {
                  id: 'asset_live',
                  description: 'The answer-first page returns 200 and is indexable',
                  check: 'page_indexable',
                },
                {
                  id: 'has_sourced_stats',
                  description: 'Page contains at least three sourced statistics',
                  check: 'sourced_stats:3',
                },
                {
                  id: 'citation_gained',
                  description: 'Property appears in probe samples for this prompt',
                  check: `probe_inclusion:${probe.prompt}=0.34`,
                },
              ],
            },
      })
    }

    return drafts
  },
}
