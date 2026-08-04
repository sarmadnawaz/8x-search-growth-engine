import { describe, it, expect } from 'vitest'
import { wilsonLowerBound, headroom, toPriority, score } from '@/lib/engine/scoring'
import { mentions } from '@/lib/engine/adapters/aiProbe'
import { PropertyConfig, type OpportunityDraft } from '@/lib/schemas'

/**
 * The parts of the engine that decide things are pure functions, so they are
 * testable without a network or a database. These cover the behaviour that
 * would be embarrassing to get wrong.
 */

const config = PropertyConfig.parse({
  domain: 'example.com',
  name: 'Example',
  description: 'An example property',
  goal: 'signups',
  conversionRoute: 'signup',
  markets: [{ market: 'us', language: 'en' }],
})

const draft: OpportunityDraft = {
  type: 'keyword',
  detectorId: 'test',
  detectorVersion: '1.0.0',
  title: 'test',
  subject: 'test',
  evidenceIds: ['e1'],
  isBlocker: false,
  impactInputs: {
    demand: 6,
    headroom: 0.6,
    coverage: 0,
    severity: 0,
    citationHeadroom: 0.8,
    aiOverviewPresent: false,
  },
  effortClass: 'new_page',
  weakestTier: 'measured',
  sourceCount: 1,
  sampleDiscount: 1,
  suggestedAction: { kind: 'k', title: 't', spec: 's', criteria: [] },
}

describe('confidence in a measurement', () => {
  it('punishes small samples at the same observed rate', () => {
    expect(wilsonLowerBound(3, 3)).toBeLessThan(wilsonLowerBound(100, 100))
    expect(wilsonLowerBound(3, 3)).toBeLessThan(0.5)
  })

  it('treats no samples as no evidence', () => {
    expect(wilsonLowerBound(0, 0)).toBe(0)
  })

  it('orders evidence tiers so modelled data cannot outrank measured', () => {
    const measured = score(draft, config)
    const modeled = score({ ...draft, weakestTier: 'modeled' }, config)
    const fixture = score({ ...draft, weakestTier: 'fixture' }, config)

    expect(modeled.rawScore).toBeLessThan(measured.rawScore)
    expect(fixture.rawScore).toBeLessThan(modeled.rawScore)
  })
})

describe('headroom', () => {
  it('is zero when already at or above the achievable position', () => {
    expect(headroom(2, 5)).toBe(0)
    expect(headroom(5, 5)).toBe(0)
  })

  it('is larger on a SERP that is genuinely winnable', () => {
    expect(headroom(null, 3)).toBeGreaterThan(headroom(null, 8))
  })
})

describe('priority mapping', () => {
  const bounds = { min: 0.5, max: 2.5 }

  it('reserves the top band for blockers', () => {
    const blocker = toPriority(1.0, true, 1, bounds)
    const bestNonBlocker = toPriority(2.5, false, 0, bounds)

    expect(blocker).toBeGreaterThanOrEqual(90)
    expect(blocker).toBeGreaterThan(bestNonBlocker)
  })

  it('normalises non-blockers into a fixed band within the snapshot', () => {
    expect(toPriority(2.5, false, 0, bounds)).toBe(89)
    expect(toPriority(0.5, false, 0, bounds)).toBe(20)
  })
})

describe('AI Overview discount', () => {
  it('reduces organic keyword impact', () => {
    const withAio = score(
      { ...draft, impactInputs: { ...draft.impactInputs, aiOverviewPresent: true } },
      config,
    )
    expect(withAio.rawScore).toBeLessThan(score(draft, config).rawScore)
  })

  it('does not touch a citation gap, which has no organic click to lose', () => {
    const on = score(
      {
        ...draft,
        type: 'geo_aeo',
        impactInputs: { ...draft.impactInputs, aiOverviewPresent: true },
      },
      config,
    )
    const off = score({ ...draft, type: 'geo_aeo' }, config)
    expect(on.rawScore).toBe(off.rawScore)
  })
})

describe('brand matching in AI answers', () => {
  const sway = {
    domain: 'sway.day',
    name: 'Sway',
    entityCollision: true,
    description: 'Guided stretching and mobility app with short daily routines for desk workers',
  }

  it('does not count a same-name product in another category', () => {
    expect(mentions('Microsoft Sway is a presentation tool from Office.', [], sway)).toBe(false)
  })

  it('counts the brand when it appears with its own category', () => {
    expect(mentions('Sway is a stretching app with daily mobility routines.', [], sway)).toBe(true)
  })

  it('always counts the domain, which is unambiguous', () => {
    expect(mentions('Try sway.day for daily routines.', [], sway)).toBe(true)
  })

  it('does not demand extra evidence for a distinctive brand', () => {
    const cherly = {
      domain: 'cherly.app',
      name: 'Cherly',
      entityCollision: false,
      description: 'AI personal stylist',
    }
    expect(mentions('Cherly is worth a look.', [], cherly)).toBe(true)
  })
})
