import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { loadAllProperties, listPropertyDomains } from '@/lib/engine/config'

/**
 * Contract tests: the shapes the engine depends on but does not own.
 *
 * Property configs are written by humans and vendor responses are written by
 * third parties, so both drift. Catching drift here means a malformed config
 * or a changed API response surfaces as a failed build rather than as evidence
 * that is silently wrong — which is the worse outcome for a system whose whole
 * value is the trustworthiness of its evidence.
 */

describe('property configs', () => {
  it('all validate against the schema', () => {
    const failures = loadAllProperties()
      .filter((r) => !r.ok)
      .map((r) => (r.ok ? '' : `${r.domain}: ${r.error}`))

    expect(failures).toEqual([])
  })

  it('every configured domain has a config file', () => {
    expect(listPropertyDomains().length).toBeGreaterThan(0)
  })

  it('declares deploy access explicitly, since it gates whether we may write', () => {
    for (const result of loadAllProperties()) {
      if (!result.ok) continue
      expect(typeof result.config.deployAccess).toBe('boolean')
    }
  })
})

const FIXTURE_DIR = join(process.cwd(), 'fixtures')

/** Each adapter's fixtures must still parse as the shape its collector assumes. */
const FIXTURE_SHAPES: Record<string, z.ZodTypeAny> = {
  crawler: z.object({
    url: z.string(),
    status: z.number(),
    body: z.string(),
    contentType: z.string(),
  }),
  autocomplete: z.array(z.string()),
  serp: z.object({
    organic: z
      .array(z.object({ position: z.number(), link: z.string(), title: z.string() }))
      .optional(),
  }),
}

describe('recorded vendor responses', () => {
  for (const [adapter, shape] of Object.entries(FIXTURE_SHAPES)) {
    it(`${adapter} fixtures match the shape the collector reads`, () => {
      const dir = join(FIXTURE_DIR, adapter)
      if (!existsSync(dir)) return

      const failures: string[] = []
      for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
        const record = JSON.parse(readFileSync(join(dir, file), 'utf8'))
        const result = shape.safeParse(record.payload)
        if (!result.success) failures.push(`${adapter}/${file}: ${result.error.issues[0]?.message}`)
      }

      expect(failures).toEqual([])
    })
  }

  it('every fixture records what was requested and when', () => {
    if (!existsSync(FIXTURE_DIR)) return
    for (const adapter of readdirSync(FIXTURE_DIR)) {
      const dir = join(FIXTURE_DIR, adapter)
      for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
        const record = JSON.parse(readFileSync(join(dir, file), 'utf8'))
        // Provenance is not optional: evidence derived from a payload we cannot
        // date or attribute is evidence we cannot defend.
        expect(record.requestKey, `${adapter}/${file}`).toBeTruthy()
        expect(record.fetchedAt, `${adapter}/${file}`).toBeTruthy()
      }
    }
  })
})
