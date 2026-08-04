import { prisma } from '../db'
import { loadProperty } from './config'
import { startLocalSite } from './localSite'
import type { Server } from 'node:http'

/**
 * "Did it get done?" — answered by observation, never by a human ticking a box.
 *
 * Each acceptance criterion is a small check expression that a collector can
 * re-run. An action only reaches `verified` when every criterion passes against
 * a fresh fetch. This is the mechanism that makes the loop closed rather than
 * a to-do list with extra steps, and it is deliberately the one part of the
 * system that cannot be talked into agreeing with itself.
 */

export interface CriterionResult {
  id: string
  description: string
  check: string
  passed: boolean
  observed: string
}

const USER_AGENT = 'SearchGrowthEngine/0.1 (verification pass)'

async function fetchPath(baseUrl: string, path: string) {
  const url = path.startsWith('http') ? path : `${baseUrl}${path}`
  try {
    const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, redirect: 'follow' })
    const body = res.status < 400 ? await res.text() : ''
    return { status: res.status, body }
  } catch (err) {
    return { status: 0, body: '', error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Check expressions are intentionally small and declarative. Anything a
 * detector can observe, a verifier can re-observe — so criteria stay honest
 * rather than drifting into prose only a human can adjudicate.
 */
async function evaluate(check: string, baseUrl: string): Promise<{ passed: boolean; observed: string }> {
  const [kind, rest] = check.split(':')

  switch (kind) {
    case 'http_status': {
      const [path, expected] = rest.split('=')
      const res = await fetchPath(baseUrl, path)
      return { passed: res.status === Number(expected), observed: `HTTP ${res.status}` }
    }
    case 'body_contains': {
      const [path, needle] = rest.split('=')
      const res = await fetchPath(baseUrl, path)
      const passed = res.status === 200 && res.body.toLowerCase().includes(needle.toLowerCase())
      return {
        passed,
        observed: res.status === 200 ? (passed ? `contains "${needle}"` : `missing "${needle}"`) : `HTTP ${res.status}`,
      }
    }
    case 'min_text_length': {
      const [path, min] = rest.split('=')
      const res = await fetchPath(baseUrl, path)
      const text = res.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      return {
        passed: text.length >= Number(min),
        observed: `${text.length} chars of initial-HTML text`,
      }
    }
    case 'page_indexable': {
      const res = await fetchPath(baseUrl, '/')
      const noindex = /<meta[^>]+name=["']robots["'][^>]+noindex/i.test(res.body)
      return { passed: res.status === 200 && !noindex, observed: `HTTP ${res.status}, noindex=${noindex}` }
    }
    case 'crawl_fact_absent': {
      const [fact, path] = rest.split('@')
      const res = await fetchPath(baseUrl, path ?? '/')
      if (res.status !== 200) return { passed: false, observed: `HTTP ${res.status}` }
      const present: Record<string, boolean> = {
        canonical_missing: !/<link[^>]+rel=["']canonical["']/i.test(res.body),
        meta_description_missing: !/<meta[^>]+name=["']description["']/i.test(res.body),
        title_missing: !/<title>[^<]+<\/title>/i.test(res.body),
        h1_missing: !/<h1[\s>]/i.test(res.body),
        schema_missing: !/application\/ld\+json/i.test(res.body),
      }
      const stillPresent = present[fact]
      return {
        passed: stillPresent === false,
        observed: stillPresent ? `${fact} still present` : `${fact} resolved`,
      }
    }
    default:
      // Outcome criteria (rank movement, snippet ownership) are measured over a
      // window by the measure stage, not verified in a single pass. Reporting
      // them as "not yet observable" is more useful than a false negative.
      return { passed: false, observed: 'measured over a window, not by re-fetch' }
  }
}

export interface VerifyResult {
  actionId: string
  title: string
  status: string
  criteria: CriterionResult[]
}

export async function verifyActions(domain: string): Promise<VerifyResult[]> {
  const config = loadProperty(domain)
  const actions = await prisma.action.findMany({
    where: { domain, status: { in: ['approved', 'executed', 'verified'] } },
  })
  if (actions.length === 0) return []

  let server: Server | undefined
  if (config.localSite) {
    server = await startLocalSite(config.localSite.dir, config.localSite.port)
  }
  const baseUrl = config.localSite
    ? `http://127.0.0.1:${config.localSite.port}`
    : `https://${config.domain}`

  const results: VerifyResult[] = []

  try {
    for (const action of actions) {
      const criteria = JSON.parse(action.criteriaJson) as {
        id: string
        description: string
        check: string
      }[]

      const evaluated: CriterionResult[] = []
      for (const criterion of criteria) {
        const outcome = await evaluate(criterion.check, baseUrl)
        evaluated.push({ ...criterion, ...outcome })
      }

      // Outcome-style criteria are excluded from the done/not-done decision:
      // "did it ship" and "did it pay off" are different questions with
      // different time horizons, and collapsing them would let a shipped fix
      // look like a failure for six weeks.
      const checkable = evaluated.filter((c) => c.observed !== 'measured over a window, not by re-fetch')
      const allPassed = checkable.length > 0 && checkable.every((c) => c.passed)
      const status = allPassed ? 'verified' : action.status === 'verified' ? 'failed' : action.status

      await prisma.action.update({
        where: { id: action.id },
        data: {
          status,
          lastCheckJson: JSON.stringify(evaluated),
          verifiedAt: allPassed ? new Date() : null,
        },
      })

      results.push({ actionId: action.id, title: action.title, status, criteria: evaluated })
    }
  } finally {
    server?.close()
  }

  return results
}
