import type { Prisma } from '@prisma/client'
import type { Server } from 'node:http'
import { prisma } from '../db'
import { loadProperty } from './config'
import { startLocalSite } from './localSite'
import { classOf, evaluateCheck, type CheckContext, type CheckOutcome } from './checks'

/**
 * The two questions, kept apart on purpose.
 *
 *   "Did it get done?"  — delivery criteria, settled by fetching the page now.
 *                         Only these may move an action to `verified`.
 *   "Did it pay off?"   — outcome criteria, settled against the evidence series
 *                         and reported as a windowed verdict.
 *
 * Every criterion is evaluated on every pass; what differs is what each class
 * is allowed to conclude. Collapsing them would either make a correctly shipped
 * fix look failed for a quarter, or let "we published something" masquerade as
 * "it worked".
 */

const USER_AGENT = 'SearchGrowthEngine/0.1 (verification pass)'

/** How long each kind of work needs before an outcome verdict means anything. */
const WINDOW_DAYS: Record<string, number> = {
  ship_robots_txt: 14,
  ship_sitemap: 14,
  fix_page_metadata: 21,
  server_render_content: 21,
  restructure_for_snippet: 42,
  publish_landing_page: 84,
  build_free_tool: 84,
  geo_retrofit: 42,
  own_brand_answer: 42,
}
const DEFAULT_WINDOW_DAYS = 42

export interface CriterionResult {
  id: string
  description: string
  check: string
  class: 'delivery' | 'outcome'
  passed: boolean
  observed: string
  verdict?: CheckOutcome['verdict']
}

export interface VerifyResult {
  actionId: string
  title: string
  status: string
  /** did the work ship */
  delivered: boolean
  /** what the outcome series says so far */
  outcome: CheckOutcome['verdict'] | null
  criteria: CriterionResult[]
}

async function fetchPath(baseUrl: string, path: string) {
  const url = path.startsWith('http') ? path : `${baseUrl}${path}`
  try {
    const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, redirect: 'follow' })
    return { status: res.status, body: res.status < 400 ? await res.text() : '' }
  } catch {
    return { status: 0, body: '' }
  }
}

/** The strongest verdict wins, so one improving metric is not hidden by a flat one. */
function summariseOutcome(verdicts: (CheckOutcome['verdict'] | undefined)[]): CheckOutcome['verdict'] | null {
  const present = verdicts.filter(Boolean) as NonNullable<CheckOutcome['verdict']>[]
  if (present.length === 0) return null
  if (present.includes('declining')) return 'declining'
  if (present.includes('improving')) return 'improving'
  if (present.every((v) => v === 'too_early')) return 'too_early'
  return 'flat'
}

export async function verifyActions(domain: string): Promise<VerifyResult[]> {
  const config = loadProperty(domain)
  const actions = await prisma.action.findMany({
    // `proposed` work has not been claimed as done by anyone, so there is
    // nothing to verify — checking it would only produce noise.
    where: { domain, status: { in: ['approved', 'executed', 'verified', 'failed'] } },
  })
  if (actions.length === 0) return []

  const latestSnapshot = await prisma.snapshot.findFirst({
    where: { domain, status: { not: 'pending' } },
    orderBy: { startedAt: 'desc' },
  })

  let server: Server | undefined
  if (config.localSite) server = await startLocalSite(config.localSite.dir, config.localSite.port)
  const baseUrl = config.localSite
    ? `http://127.0.0.1:${config.localSite.port}`
    : `https://${config.domain}`

  const results: VerifyResult[] = []

  try {
    for (const action of actions) {
      const criteria = action.criteria as unknown as {
        id: string
        description: string
        check: string
      }[]

      const windowDays = WINDOW_DAYS[action.kind] ?? DEFAULT_WINDOW_DAYS
      // Measured from when the work shipped, not from when it was proposed:
      // an action that sat in review for a month has not been live for a month.
      const shippedAt = action.verifiedAt ?? action.createdAt
      const daysElapsed = Math.floor((Date.now() - shippedAt.getTime()) / 86_400_000)

      const ctx: CheckContext = {
        domain,
        baseUrl,
        windowDays,
        fetchPath: (path) => fetchPath(baseUrl, path),
      }

      const evaluated: CriterionResult[] = []
      const outcomeVerdicts: (CheckOutcome['verdict'] | undefined)[] = []

      for (const criterion of criteria) {
        const kind = classOf(criterion.check)
        const outcome = await evaluateCheck(criterion.check, ctx, daysElapsed)

        evaluated.push({
          ...criterion,
          class: kind,
          passed: outcome.passed,
          observed: outcome.observed,
          verdict: outcome.verdict,
        })

        if (kind === 'outcome') {
          outcomeVerdicts.push(outcome.verdict)

          // Outcome checks are the measure stage: each one persists a row so
          // the payoff question has a history rather than a live opinion.
          if (outcome.metric) {
            await prisma.measurement.upsert({
              where: {
                actionId_metric: { actionId: action.id, metric: outcome.metric },
              },
              create: {
                domain,
                snapshotId: latestSnapshot?.id ?? '',
                actionId: action.id,
                metric: outcome.metric,
                baseline: outcome.baseline,
                current: outcome.current,
                windowDays,
                verdict: outcome.verdict ?? 'too_early',
              },
              update: {
                current: outcome.current,
                verdict: outcome.verdict ?? 'too_early',
                snapshotId: latestSnapshot?.id ?? '',
              },
            })
          }
        }
      }

      // Delivery alone decides `verified`. An action already verified whose
      // delivery criteria stop passing flips to `failed` — fixes get reverted.
      const delivery = evaluated.filter((c) => c.class === 'delivery')
      const delivered = delivery.length > 0 && delivery.every((c) => c.passed)
      const status = delivered ? 'verified' : action.status === 'verified' ? 'failed' : action.status

      await prisma.action.update({
        where: { id: action.id },
        data: {
          status,
          lastCheck: evaluated as unknown as Prisma.InputJsonValue,
          verifiedAt: delivered ? (action.verifiedAt ?? new Date()) : null,
        },
      })

      results.push({
        actionId: action.id,
        title: action.title,
        status,
        delivered,
        outcome: summariseOutcome(outcomeVerdicts),
        criteria: evaluated,
      })
    }
  } finally {
    server?.close()
  }

  return results
}
