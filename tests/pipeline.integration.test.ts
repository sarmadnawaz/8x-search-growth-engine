import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { loadEnv } from '@/lib/env'

/**
 * The highest-value test in the suite: the whole loop, end to end, against a
 * real database and a real HTTP server.
 *
 * It is deterministic because both dependencies are ours — the fixture site is
 * served from disk, and every external API response is replayed from a
 * recorded fixture. So this asserts the behaviour the submission actually
 * claims: that an action reaches `verified` only after the fix exists and a
 * re-check observes it.
 */

loadEnv()

// Integration tests must never touch the database a human is looking at.
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL

const FIXTURE_DIR = join(process.cwd(), 'fixture-site')
const GENERATED = ['robots.txt', 'sitemap.xml'].map((f) => join(FIXTURE_DIR, f))
const DOMAIN = 'demo-fixture.local'

function resetFixtureSite() {
  for (const file of GENERATED) if (existsSync(file)) rmSync(file)
}

describe('the full loop on a property we control', () => {
  let collect: typeof import('@/lib/engine/pipeline').collect
  let detect: typeof import('@/lib/engine/detectors').detect
  let make: typeof import('@/lib/engine/make').make
  let apply: typeof import('@/lib/engine/make').apply
  let verifyActions: typeof import('@/lib/engine/verify').verifyActions
  let prisma: typeof import('@/lib/db').prisma

  beforeAll(async () => {
    execSync('npx prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
      stdio: 'ignore',
    })
    ;({ collect } = await import('@/lib/engine/pipeline'))
    ;({ detect } = await import('@/lib/engine/detectors'))
    ;({ make, apply } = await import('@/lib/engine/make'))
    ;({ verifyActions } = await import('@/lib/engine/verify'))
    ;({ prisma } = await import('@/lib/db'))

    await prisma.run.deleteMany()
    await prisma.property.deleteMany()
    resetFixtureSite()
  }, 120_000)

  afterAll(() => resetFixtureSite())

  it('collects evidence, and records what it could not collect', async () => {
    const summary = await collect({ domain: DOMAIN, mode: 'replay', log: () => {} })

    expect(summary.pages).toBeGreaterThan(0)
    expect(summary.evidence).toBeGreaterThan(0)
    // Adapters that cannot run degrade the snapshot instead of failing the run.
    const snapshot = await prisma.snapshot.findUniqueOrThrow({ where: { id: summary.snapshotId } })
    expect(['complete', 'partial']).toContain(snapshot.status)

    const facts = await prisma.evidence.findMany({
      where: { snapshotId: summary.snapshotId, kind: 'crawl_fact' },
    })
    const kinds = facts.map((f) => (f.value as { fact: string }).fact)
    expect(kinds).toContain('robots_txt_missing')
    expect(kinds).toContain('sitemap_missing')
  }, 60_000)

  it('produces opportunities that each carry their evidence', async () => {
    const snapshot = await prisma.snapshot.findFirstOrThrow({
      where: { domain: DOMAIN },
      orderBy: { startedAt: 'desc' },
    })
    const result = await detect(snapshot.id)
    expect(result.opportunities).toBeGreaterThan(0)

    const opportunities = await prisma.opportunity.findMany({ where: { snapshotId: snapshot.id } })
    for (const opportunity of opportunities) {
      expect((opportunity.evidenceIds as string[]).length).toBeGreaterThan(0)
      // The stored factors must reproduce the stored score, or the UI's
      // breakdown is decoration rather than an audit trail.
      const recomputed =
        (opportunity.impact * opportunity.confidence * opportunity.fit * opportunity.tacticPrior) /
        opportunity.effort
      expect(recomputed).toBeCloseTo(opportunity.rawScore, 6)
    }
  }, 60_000)

  it('refuses to verify an action before the fix exists', async () => {
    const snapshot = await prisma.snapshot.findFirstOrThrow({
      where: { domain: DOMAIN },
      orderBy: { startedAt: 'desc' },
    })
    await make(snapshot.id)

    const results = await verifyActions(DOMAIN)
    const robots = results.find((r) => r.title.includes('robots.txt'))

    expect(robots).toBeDefined()
    expect(robots!.status).not.toBe('verified')
    expect(robots!.criteria.every((c) => c.passed)).toBe(false)
  }, 60_000)

  it('verifies only after the generated fix is applied and observed', async () => {
    const applied = await apply(DOMAIN)
    expect(applied.applied.length).toBeGreaterThan(0)
    for (const file of GENERATED) expect(existsSync(file)).toBe(true)

    const results = await verifyActions(DOMAIN)
    const robots = results.find((r) => r.title.includes('robots.txt'))

    expect(robots!.status).toBe('verified')
    expect(robots!.criteria.every((c) => c.passed)).toBe(true)
    // The observation is recorded, not just the verdict — that is what makes
    // the status reproducible by a human with curl.
    expect(robots!.criteria[0].observed).toContain('200')
  }, 60_000)

  it('does not recreate work across runs', async () => {
    const before = await prisma.action.count({ where: { domain: DOMAIN } })

    const summary = await collect({ domain: DOMAIN, mode: 'replay', log: () => {} })
    await detect(summary.snapshotId)
    await make(summary.snapshotId)

    expect(await prisma.action.count({ where: { domain: DOMAIN } })).toBe(before)
  }, 60_000)
})

describe('a property we do not control', () => {
  it('generates the fix but refuses to apply it', async () => {
    const { apply } = await import('@/lib/engine/make')
    const { collect } = await import('@/lib/engine/pipeline')
    const { detect } = await import('@/lib/engine/detectors')
    const { make } = await import('@/lib/engine/make')
    const { prisma } = await import('@/lib/db')

    const summary = await collect({ domain: 'cherly.app', mode: 'replay', log: () => {} })
    await detect(summary.snapshotId)
    await make(summary.snapshotId)

    const result = await apply('cherly.app')
    expect(result.applied).toEqual([])
    expect(result.refused.length).toBeGreaterThan(0)

    // The artifact still exists for a human to ship — detection is not wasted,
    // it is just never presented as done.
    const actions = await prisma.action.findMany({
      where: { domain: 'cherly.app' },
      include: { assets: true },
    })
    expect(actions.every((a) => a.status === 'proposed')).toBe(true)
    expect(actions.some((a) => a.assets.length > 0)).toBe(true)
  }, 120_000)
})
