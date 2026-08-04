import { describe, it, expect } from 'vitest'
import { technicalDetector } from '@/lib/engine/detectors/technical'
import { keywordGapDetector } from '@/lib/engine/detectors/keyword'
import { aiCitationDetector } from '@/lib/engine/detectors/geo'
import { PropertyConfig, OpportunityDraft } from '@/lib/schemas'
import type { Evidence, Page, QueryCluster } from '@prisma/client'

/**
 * Golden tests for detectors.
 *
 * Detectors are the point where raw facts become claims about what to do, and
 * they drift silently: a tweak to a severity weight or a filter changes what
 * the whole portfolio is told to work on, with no error anywhere. Worse, the
 * learn loop keys its win-rate priors on detector version, so a change in
 * meaning without a change in version quietly corrupts historical comparison.
 *
 * These pin the exact output for a known input.
 */

const config = PropertyConfig.parse({
  domain: 'example.com',
  name: 'Example',
  description: 'An example property for testing',
  goal: 'signups',
  conversionRoute: 'signup',
  markets: [{ market: 'us', language: 'en' }],
  fitWeights: { commercial: 1.3, informational: 1.0 },
})

function evidence(partial: Partial<Evidence> & { kind: string; value: unknown }): Evidence {
  return {
    id: partial.id ?? `e-${Math.abs(hash(JSON.stringify(partial.value)))}`,
    domain: 'example.com',
    snapshotId: 'snap-1',
    kind: partial.kind,
    source: partial.source ?? 'crawler',
    tier: partial.tier ?? 'measured',
    subject: partial.subject ?? 'example.com',
    value: partial.value as never,
    clusterId: null,
    schemaVersion: 1,
    fetchedAt: new Date('2026-01-01'),
    rawRef: null,
  } as Evidence
}

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i)
  return h
}

const page = (url: string): Page =>
  ({
    id: `p-${url}`,
    domain: 'example.com',
    snapshotId: 'snap-1',
    url,
    status: 200,
    indexable: true,
    title: 'Title',
    metaDescription: null,
    h1: 'H1',
    canonical: null,
    robotsMeta: null,
    schemaTypes: [] as never,
    internalLinks: 3,
    wordCount: 400,
    rawTextLength: 2000,
    fetchedAt: new Date('2026-01-01'),
  }) as Page

describe('technical detector', () => {
  const input = {
    config,
    pages: [page('https://example.com/'), page('https://example.com/pricing')],
    clusters: [] as QueryCluster[],
    evidence: [
      evidence({
        kind: 'crawl_fact',
        subject: 'https://example.com/robots.txt',
        value: { fact: 'robots_txt_missing', url: 'https://example.com/robots.txt', detail: {} },
      }),
      evidence({
        kind: 'crawl_fact',
        subject: 'https://example.com/',
        value: { fact: 'canonical_missing', url: 'https://example.com/', detail: {} },
      }),
      evidence({
        kind: 'crawl_fact',
        subject: 'https://example.com/pricing',
        value: { fact: 'canonical_missing', url: 'https://example.com/pricing', detail: {} },
      }),
    ],
  }

  const drafts = technicalDetector.run(input).map((d) => OpportunityDraft.parse(d))

  it('groups a repeated page-level fact into one opportunity', () => {
    const canonical = drafts.filter((d) => d.title.includes('canonical'))
    expect(canonical).toHaveLength(1)
    expect(canonical[0].title).toBe('canonical link missing on 2 of 2 crawled pages')
    expect(canonical[0].evidenceIds).toHaveLength(2)
  })

  it('does not classify a missing robots.txt as a blocker', () => {
    // Google treats a 404 robots.txt as allow-all. Calling it a blocker would
    // discredit the blocker class for conditions that genuinely gate indexing.
    const robots = drafts.find((d) => d.title.includes('robots.txt'))
    expect(robots?.isBlocker).toBe(false)
    expect(robots?.effortClass).toBe('technical_fix')
  })

  it('attaches machine-checkable criteria to every action it proposes', () => {
    for (const d of drafts) {
      expect(d.suggestedAction.criteria.length).toBeGreaterThan(0)
      for (const c of d.suggestedAction.criteria) expect(c.check).toMatch(/.+:.+/)
    }
  })

  it('never emits an opportunity without evidence', () => {
    for (const d of drafts) expect(d.evidenceIds.length).toBeGreaterThan(0)
  })
})

describe('keyword detector', () => {
  const cluster = {
    id: 'c1',
    domain: 'example.com',
    market: 'us',
    query: 'example widget',
    intent: 'commercial',
    demand: 7,
    demandSource: 'modeled',
    createdAt: new Date('2026-01-01'),
  } as QueryCluster

  it('rates a UGC-heavy SERP as more winnable than one full of brands', () => {
    const ugc = keywordGapDetector.run({
      config,
      pages: [],
      clusters: [cluster],
      evidence: [
        evidence({
          kind: 'serp_observation',
          subject: 'example widget',
          value: {
            query: 'example widget',
            market: 'us',
            ownPosition: null,
            topResults: [
              { position: 1, url: 'https://reddit.com/r/a', title: 'a' },
              { position: 2, url: 'https://quora.com/b', title: 'b' },
              { position: 3, url: 'https://medium.com/c', title: 'c' },
            ],
            serpFeatures: [],
            aiOverviewPresent: null,
          },
        }),
      ],
    })

    const brands = keywordGapDetector.run({
      config,
      pages: [],
      clusters: [cluster],
      evidence: [
        evidence({
          kind: 'serp_observation',
          subject: 'example widget',
          value: {
            query: 'example widget',
            market: 'us',
            ownPosition: null,
            topResults: [
              { position: 1, url: 'https://bigbrand.com/a', title: 'a' },
              { position: 2, url: 'https://established.com/b', title: 'b' },
            ],
            serpFeatures: [],
            aiOverviewPresent: null,
          },
        }),
      ],
    })

    expect(ugc[0].impactInputs.headroom).toBeGreaterThan(brands[0].impactInputs.headroom)
  })

  it('inherits the weaker tier when demand is modelled', () => {
    const drafts = keywordGapDetector.run({
      config,
      pages: [],
      clusters: [cluster],
      evidence: [
        evidence({
          kind: 'serp_observation',
          subject: 'example widget',
          value: {
            query: 'example widget',
            market: 'us',
            ownPosition: null,
            topResults: [],
            serpFeatures: [],
            aiOverviewPresent: null,
          },
        }),
      ],
    })
    expect(drafts[0].weakestTier).toBe('modeled')
  })
})

describe('AI citation detector', () => {
  it('emits nothing when there is no probe evidence, rather than assuming absence', () => {
    const drafts = aiCitationDetector.run({ config, pages: [], clusters: [], evidence: [] })
    expect(drafts).toEqual([])
  })

  it('scores on citation headroom and skips prompts where we are always cited', () => {
    const drafts = aiCitationDetector.run({
      config,
      pages: [],
      clusters: [],
      evidence: [
        evidence({
          kind: 'ai_answer_probe',
          source: 'ai_probe:test',
          subject: 'best widget?',
          value: {
            prompt: 'best widget?',
            engine: 'test',
            samples: 3,
            mentions: 0,
            citedUrls: ['https://rival.com/list', 'https://rival.com/list2'],
            ownCitations: [],
            inclusionLowerBound: 0,
          },
        }),
        evidence({
          kind: 'ai_answer_probe',
          source: 'ai_probe:test',
          subject: 'always cited?',
          value: {
            prompt: 'always cited?',
            engine: 'test',
            samples: 3,
            mentions: 3,
            citedUrls: [],
            ownCitations: [],
            inclusionLowerBound: 0.4,
          },
        }),
      ],
    })

    expect(drafts).toHaveLength(1)
    expect(drafts[0].subject).toBe('best widget?')
    expect(drafts[0].impactInputs.citationHeadroom).toBe(1)
    expect(drafts[0].type).toBe('geo_aeo')
  })
})
