import test from 'node:test'
import assert from 'node:assert/strict'
import { wilsonLowerBound, headroom, toPriority, score } from '../lib/engine/scoring'
import { mentions } from '../lib/engine/adapters/aiProbe'
import { PropertyConfig, type OpportunityDraft } from '../lib/schemas'

/**
 * The parts of the engine that decide things are pure functions, so they are
 * testable without a network or a database. These tests cover the behaviour
 * that would be embarrassing to get wrong: sample-size discounting, headroom,
 * the priority mapping, and brand matching for collision-prone names.
 */

test('wilson lower bound punishes small samples', () => {
  // Same 100% inclusion rate, very different certainty.
  const small = wilsonLowerBound(3, 3)
  const large = wilsonLowerBound(100, 100)
  assert.ok(small < large, 'three-for-three should be less certain than 100-for-100')
  assert.ok(small < 0.5, `n=3 should stay well under 0.5, got ${small}`)
  assert.equal(wilsonLowerBound(0, 0), 0, 'no samples means no evidence')
})

test('headroom is zero when already at or above the achievable position', () => {
  assert.equal(headroom(2, 5), 0)
  assert.equal(headroom(5, 5), 0)
  assert.ok(headroom(null, 5) > 0, 'not ranking at all leaves headroom')
  assert.ok(
    headroom(null, 3) > headroom(null, 8),
    'a more winnable SERP should offer more headroom',
  )
})

test('priority mapping reserves the top band for blockers', () => {
  const bounds = { min: 0.5, max: 2.5 }
  const blocker = toPriority(1.0, true, 1, bounds)
  const best = toPriority(2.5, false, 0, bounds)
  const worst = toPriority(0.5, false, 0, bounds)

  assert.ok(blocker >= 90, `blockers occupy 90-100, got ${blocker}`)
  assert.equal(best, 89, 'the best non-blocker tops out at 89')
  assert.equal(worst, 20, 'the weakest non-blocker floors at 20')
  assert.ok(blocker > best, 'a blocker always outranks demand-scored work')
})

test('modeled evidence cannot outscore measured evidence, all else equal', () => {
  const config = PropertyConfig.parse({
    domain: 'example.com',
    name: 'Example',
    description: 'An example property',
    goal: 'signups',
    conversionRoute: 'signup',
    markets: [{ market: 'us', language: 'en' }],
  })

  const base: OpportunityDraft = {
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
      citationHeadroom: 0,
      aiOverviewPresent: false,
    },
    effortClass: 'new_page',
    weakestTier: 'measured',
    sourceCount: 1,
    sampleDiscount: 1,
    suggestedAction: { kind: 'k', title: 't', spec: 's', criteria: [] },
  }

  const measured = score(base, config)
  const modeled = score({ ...base, weakestTier: 'modeled' }, config)
  const fixture = score({ ...base, weakestTier: 'fixture' }, config)

  assert.ok(modeled.rawScore < measured.rawScore)
  assert.ok(fixture.rawScore < modeled.rawScore, 'fixture data must rank lowest of all')
})

test('an AI Overview discounts organic keyword impact but not citation gaps', () => {
  const config = PropertyConfig.parse({
    domain: 'example.com',
    name: 'Example',
    description: 'An example property',
    goal: 'signups',
    conversionRoute: 'signup',
    markets: [{ market: 'us', language: 'en' }],
  })

  const keyword: OpportunityDraft = {
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
      aiOverviewPresent: true,
    },
    effortClass: 'new_page',
    weakestTier: 'measured',
    sourceCount: 1,
    sampleDiscount: 1,
    suggestedAction: { kind: 'k', title: 't', spec: 's', criteria: [] },
  }

  const withAio = score(keyword, config)
  const withoutAio = score(
    { ...keyword, impactInputs: { ...keyword.impactInputs, aiOverviewPresent: false } },
    config,
  )
  assert.ok(withAio.rawScore < withoutAio.rawScore, 'an AI Overview absorbs organic clicks')

  // The same flag must not touch a geo_aeo row: there is no organic click to lose.
  const geoWith = score({ ...keyword, type: 'geo_aeo' }, config)
  const geoWithout = score(
    { ...keyword, type: 'geo_aeo', impactInputs: { ...keyword.impactInputs, aiOverviewPresent: false } },
    config,
  )
  assert.equal(geoWith.rawScore, geoWithout.rawScore)
})

test('collision-prone brands are not matched on the bare brand string', () => {
  const sway = {
    domain: 'sway.day',
    name: 'Sway',
    entityCollision: true,
    description: 'Guided stretching and mobility app with short daily routines for desk workers',
  }

  // Microsoft Sway is not our stretching app.
  assert.equal(
    mentions('Microsoft Sway is a presentation tool from Office.', [], sway),
    false,
    'a same-name product in another category must not count as a mention',
  )
  assert.equal(
    mentions('Sway is a stretching app with daily mobility routines.', [], sway),
    true,
    'brand plus category words is a real mention',
  )
  assert.equal(
    mentions('Try sway.day for daily routines.', [], sway),
    true,
    'the domain is always unambiguous',
  )

  // Distinctive brands do not need the extra evidence.
  const cherly = {
    domain: 'cherly.app',
    name: 'Cherly',
    entityCollision: false,
    description: 'AI personal stylist',
  }
  assert.equal(mentions('Cherly is worth a look.', [], cherly), true)
})
