import { lookup } from 'node:dns/promises'

/**
 * One place where every outbound request in the engine is made.
 *
 * Three properties the adapters cannot be trusted to remember individually:
 *
 *   TIMEOUTS  — Node's fetch has no overall deadline. A host that drip-feeds
 *               a byte a minute holds the connection, and because a fleet run
 *               is a single pass, one slow host stalls every property behind
 *               it with nothing else making progress.
 *
 *   SSRF      — the engine fetches URLs it did not choose: `Sitemap:` lines in
 *               a competitor's robots.txt, `<loc>` entries in their sitemap.
 *               Those are third-party controlled, and the response bodies get
 *               written to disk. Without a guard that is a read-anything
 *               primitive pointed at the cloud metadata endpoint.
 *
 *   SIZE      — responses are parsed and archived whole. An unbounded body is
 *               an unbounded heap allocation and an unbounded disk write.
 */

export interface FetchResult {
  url: string
  status: number
  body: string
  contentType: string
  /** why the request produced no usable body, when that is the case */
  failure?: 'timeout' | 'blocked' | 'network' | 'too_large' | 'wrong_type'
}

const MAX_BYTES = 5 * 1024 * 1024

/** Hosts that resolve into infrastructure rather than the public web. */
function isPrivateAddress(address: string): boolean {
  if (address.includes(':')) {
    // IPv6 loopback, link-local, unique-local
    return /^(::1|fe80:|fc|fd)/i.test(address)
  }
  const [a, b] = address.split('.').map(Number)
  return (
    a === 127 || // loopback
    a === 10 || // private
    a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) || // link-local, incl. cloud metadata
    (a === 100 && b >= 64 && b <= 127) // carrier-grade NAT
  )
}

export async function assertPublicUrl(url: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, reason: 'unparseable URL' }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: `scheme ${parsed.protocol} not allowed` }
  }

  // Local development sites are served by us and are explicitly permitted;
  // everything else must resolve to a public address.
  if (/^(127\.0\.0\.1|localhost|\[::1\])$/.test(parsed.hostname)) return { ok: true }

  try {
    const records = await lookup(parsed.hostname, { all: true })
    if (records.some((r) => isPrivateAddress(r.address))) {
      return { ok: false, reason: `${parsed.hostname} resolves to a private address` }
    }
  } catch {
    return { ok: false, reason: `${parsed.hostname} does not resolve` }
  }

  return { ok: true }
}

/**
 * Fetch with a deadline, an SSRF guard and a size cap.
 *
 * Redirects are followed manually so each hop is validated: a public hostname
 * that 302s to 169.254.169.254 would otherwise sail through a single up-front
 * check.
 */
export async function safeFetch(
  url: string,
  options: { timeoutMs?: number; userAgent: string; maxRedirects?: number } ,
): Promise<FetchResult> {
  const { timeoutMs = 15_000, userAgent, maxRedirects = 5 } = options
  let current = url

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const allowed = await assertPublicUrl(current)
    if (!allowed.ok) {
      return { url: current, status: 0, body: '', contentType: '', failure: 'blocked' }
    }

    let res: Response
    try {
      res = await fetch(current, {
        headers: { 'user-agent': userAgent, accept: 'text/html,application/xhtml+xml,text/*,*/*' },
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      const timedOut = err instanceof Error && /timeout|abort/i.test(err.name + err.message)
      return {
        url: current,
        status: 0,
        body: '',
        contentType: '',
        failure: timedOut ? 'timeout' : 'network',
      }
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) return { url: current, status: res.status, body: '', contentType: '' }
      current = new URL(location, current).toString()
      continue
    }

    const contentType = res.headers.get('content-type') ?? ''
    if (res.status >= 400) {
      // The status is the finding. Reading the body of an error page only
      // risks parsing a WAF challenge as if it were the site.
      return { url: res.url || current, status: res.status, body: '', contentType }
    }

    const declared = Number(res.headers.get('content-length') ?? 0)
    if (declared > MAX_BYTES) {
      return { url: res.url || current, status: res.status, body: '', contentType, failure: 'too_large' }
    }

    const body = await readCapped(res)
    if (body === null) {
      return { url: res.url || current, status: res.status, body: '', contentType, failure: 'too_large' }
    }

    return { url: res.url || current, status: res.status, body, contentType }
  }

  return { url: current, status: 0, body: '', contentType: '', failure: 'network' }
}

/** Read a body, abandoning it if it grows past the cap rather than after. */
async function readCapped(res: Response): Promise<string | null> {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }

  return new TextDecoder().decode(
    chunks.reduce((acc, chunk) => {
      const merged = new Uint8Array(acc.length + chunk.length)
      merged.set(acc)
      merged.set(chunk, acc.length)
      return merged
    }, new Uint8Array()),
  )
}
