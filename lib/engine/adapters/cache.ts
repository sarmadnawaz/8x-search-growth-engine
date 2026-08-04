import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Every external response is written to fixtures/ on first success and read
 * back in replay mode.
 *
 * This is not a performance cache. It is:
 *   - the reviewer's no-keys path (`--replay` reproduces a full run offline)
 *   - protection for finite free-tier credits during development
 *   - the archive that makes evidence re-derivable when a detector changes
 *
 * In production the same seam writes to object storage instead of disk.
 */

const FIXTURE_DIR = join(process.cwd(), 'fixtures')

function fixturePath(adapter: string, requestKey: string): string {
  const hash = createHash('sha256').update(requestKey).digest('hex').slice(0, 16)
  return join(FIXTURE_DIR, adapter, `${hash}.json`)
}

export interface CachedPayload<T> {
  requestKey: string
  fetchedAt: string
  payload: T
}

export function readFixture<T>(adapter: string, requestKey: string): CachedPayload<T> | null {
  const path = fixturePath(adapter, requestKey)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as CachedPayload<T>
  } catch {
    return null
  }
}

export function writeFixture<T>(adapter: string, requestKey: string, payload: T): void {
  const path = fixturePath(adapter, requestKey)
  mkdirSync(dirname(path), { recursive: true })
  const record: CachedPayload<T> = {
    requestKey,
    fetchedAt: new Date().toISOString(),
    payload,
  }
  writeFileSync(path, JSON.stringify(record, null, 2))
}

export class MissingFixtureError extends Error {
  constructor(adapter: string, requestKey: string) {
    super(`replay mode: no fixture for ${adapter} "${requestKey}" — run live once to record it`)
    this.name = 'MissingFixtureError'
  }
}

/**
 * Fetch through the cache. In replay mode a missing fixture is an explicit
 * error rather than a silent empty result: absence of evidence must never be
 * indistinguishable from evidence of absence.
 */
/**
 * Local URLs are never cached, in either direction.
 *
 * The cache protects external dependencies — rate limits, credits, politeness
 * budgets — and a server we run ourselves has none of those. Caching it is
 * actively harmful: a recorded fixture would keep replaying the site as it was
 * before the engine shipped its fixes, so a change the engine made could never
 * appear in a later snapshot. A fixture of 127.0.0.1 is also meaningless on
 * any other machine.
 */
function isLocal(requestKey: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/.test(requestKey)
}

export async function cached<T>(
  adapter: string,
  requestKey: string,
  mode: 'live' | 'replay',
  fetcher: () => Promise<T>,
): Promise<{ payload: T; cached: boolean; latencyMs: number }> {
  if (isLocal(requestKey)) {
    const started = Date.now()
    const payload = await fetcher()
    return { payload, cached: false, latencyMs: Date.now() - started }
  }

  const hit = readFixture<T>(adapter, requestKey)
  if (hit) return { payload: hit.payload, cached: true, latencyMs: 0 }
  if (mode === 'replay') throw new MissingFixtureError(adapter, requestKey)

  const started = Date.now()
  const payload = await fetcher()
  const latencyMs = Date.now() - started
  writeFixture(adapter, requestKey, payload)
  return { payload, cached: false, latencyMs }
}
