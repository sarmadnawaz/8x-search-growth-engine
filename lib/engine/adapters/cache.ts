import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Recorded vendor responses.
 *
 * Two jobs, and conflating them was a bug worth stating plainly: this is an
 * *archive* for replay and audit, and it is a *freshness cache* for live runs.
 * The first version had no expiry and short-circuited live fetches whenever a
 * recording existed — so the second run of a property replayed the first run's
 * crawl, SERPs and probes forever. Every trend the engine measures is a diff
 * between snapshots, so a permanent cache meant every verdict was `flat` by
 * construction and no property could ever be observed to change.
 *
 * Now a live run only reuses a recording inside its freshness window; outside
 * it, the call is made again and the archive gains a new dated entry. Replay
 * still reads the most recent recording regardless of age, because replay is
 * reproducing a past run rather than observing the present.
 */

const FIXTURE_DIR = join(process.cwd(), 'fixtures')

/**
 * How long a recorded response stays usable in a live run, per adapter.
 *
 * These are cost decisions, not correctness ones: a crawl is cheap and should
 * be fresh, a SERP costs credits and a day-old ranking is still a ranking, and
 * a grounded LLM probe is the most expensive call in the system.
 */
const DEFAULT_MAX_AGE_MS: Record<string, number> = {
  crawler: 6 * 60 * 60 * 1000, // 6 hours
  serp: 20 * 60 * 60 * 1000, // just under a day, so a daily run always refreshes
  autocomplete: 7 * 24 * 60 * 60 * 1000, // demand moves slowly
  competitor: 7 * 24 * 60 * 60 * 1000,
  psi: 24 * 60 * 60 * 1000,
  ai_probe: 7 * 24 * 60 * 60 * 1000,
}
const FALLBACK_MAX_AGE_MS = 24 * 60 * 60 * 1000

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
  // Write-then-rename: two workers recording the same request key (sibling
  // properties sharing a query is a designed-for case) would otherwise
  // interleave into a torn file that fails to parse and re-spends the call.
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, JSON.stringify(record, null, 2))
  renameSync(temp, path)
}

export class MissingFixtureError extends Error {
  constructor(adapter: string, requestKey: string) {
    super(`replay mode: no fixture for ${adapter} "${requestKey}" — run live once to record it`)
    this.name = 'MissingFixtureError'
  }
}

/**
 * Local URLs are never cached, in either direction.
 *
 * The cache protects external dependencies — rate limits, credits, politeness
 * budgets — and a server we run ourselves has none of those. A fixture of
 * 127.0.0.1 is also meaningless on any other machine.
 */
function isLocal(requestKey: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/.test(requestKey)
}

function isFresh(record: CachedPayload<unknown>, adapter: string): boolean {
  const maxAge = DEFAULT_MAX_AGE_MS[adapter] ?? FALLBACK_MAX_AGE_MS
  const age = Date.now() - new Date(record.fetchedAt).getTime()
  return Number.isFinite(age) && age >= 0 && age < maxAge
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

  // Replay reproduces a past run, so age is irrelevant there. A live run may
  // only reuse a recording that is still within its freshness window.
  if (hit && (mode === 'replay' || isFresh(hit, adapter))) {
    return { payload: hit.payload, cached: true, latencyMs: 0 }
  }
  if (mode === 'replay') throw new MissingFixtureError(adapter, requestKey)

  const started = Date.now()
  const payload = await fetcher()
  const latencyMs = Date.now() - started
  writeFixture(adapter, requestKey, payload)
  return { payload, cached: false, latencyMs }
}
