import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { PropertyConfig } from '../schemas'

const PROPERTIES_DIR = join(process.cwd(), 'properties')

/**
 * Property configs are the only per-property surface in the system. A config
 * that fails validation is skipped and reported — one bad file must never take
 * down a fleet run.
 */
export function loadProperty(domain: string): PropertyConfig {
  const raw = readFileSync(join(PROPERTIES_DIR, `${domain}.yaml`), 'utf8')
  return PropertyConfig.parse(parse(raw))
}

export function listPropertyDomains(): string[] {
  return readdirSync(PROPERTIES_DIR)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => f.replace(/\.yaml$/, ''))
    .sort()
}

export type LoadResult =
  | { ok: true; config: PropertyConfig }
  | { ok: false; domain: string; error: string }

export function loadAllProperties(): LoadResult[] {
  return listPropertyDomains().map((domain) => {
    try {
      return { ok: true as const, config: loadProperty(domain) }
    } catch (err) {
      return { ok: false as const, domain, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
