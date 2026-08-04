/**
 * The repeatability test, as a check that can fail CI.
 *
 * The brief's acceptance criterion is that adding the 21st property is
 * configuration and review, not a new code path. That claim is easy to assert
 * and easy to quietly break, so it is enforced here:
 *
 *   1. no file under lib/engine/ or app/ may mention a configured domain
 *   2. every property config must validate against the schema
 *
 * If someone special-cases a property inside the engine, this exits non-zero.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { loadAllProperties, listPropertyDomains } from '../lib/engine/config'

const ROOT = process.cwd()
const SCANNED_DIRS = ['lib', 'app']
const ALLOWLIST = [
  // this file names domains by definition; so does the config loader's directory
  'scripts/check-onboarding.ts',
]

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx)$/.test(full)) out.push(full)
  }
  return out
}

let failures = 0

// 1. engine code must be domain-agnostic
const domains = listPropertyDomains()
const files = SCANNED_DIRS.flatMap((d) => walk(join(ROOT, d)))
for (const file of files) {
  const rel = relative(ROOT, file)
  if (ALLOWLIST.includes(rel)) continue
  const source = readFileSync(file, 'utf8')
  for (const domain of domains) {
    if (source.includes(domain)) {
      console.error(`FAIL ${rel} references the configured property "${domain}"`)
      console.error('      Engine code must be property-agnostic; move this into properties/*.yaml')
      failures++
    }
  }
}

// 2. every config must be valid
for (const result of loadAllProperties()) {
  if (!result.ok) {
    console.error(`FAIL properties/${result.domain}.yaml does not validate: ${result.error}`)
    failures++
  }
}

if (failures > 0) {
  console.error(`\n${failures} onboarding check failure(s).`)
  process.exit(1)
}

console.log(
  `onboarding check passed: ${domains.length} properties validate, ` +
    `${files.length} engine/UI files contain no property-specific code`,
)
