import { prisma } from '../../db'
import { OpportunityDraft, type PropertyConfig } from '../../schemas'
import { loadProperty } from '../config'
import { score, toPriority } from '../scoring'
import { technicalDetector } from './technical'
import { keywordGapDetector, snippetDetector } from './keyword'
import { aiCitationDetector } from './geo'
import type { Detector } from './types'

export const DETECTORS: Detector[] = [
  technicalDetector,
  keywordGapDetector,
  snippetDetector,
  aiCitationDetector,
]

export interface DetectSummary {
  snapshotId: string
  opportunities: number
  blockers: number
  byDetector: Record<string, number>
}

/**
 * Turn one snapshot's evidence into scored, prioritised opportunities.
 *
 * Detectors propose; scoring disposes. Priorities are assigned after all drafts
 * exist because normalisation is relative to the run — a priority is a rank
 * within a snapshot, not an absolute measurement.
 */
export async function detect(snapshotId: string): Promise<DetectSummary> {
  const snapshot = await prisma.snapshot.findUniqueOrThrow({ where: { id: snapshotId } })
  const config: PropertyConfig = loadProperty(snapshot.domain)

  const [evidence, pages, clusters] = await Promise.all([
    prisma.evidence.findMany({ where: { snapshotId } }),
    prisma.page.findMany({ where: { snapshotId } }),
    prisma.queryCluster.findMany({ where: { domain: snapshot.domain } }),
  ])

  const input = { config, evidence, pages, clusters }
  const drafts: OpportunityDraft[] = []
  const byDetector: Record<string, number> = {}

  for (const detector of DETECTORS) {
    // A detector that throws must not take the run down with it: the others
    // still produce evidence-backed opportunities.
    try {
      const produced = detector.run(input).map((d) => OpportunityDraft.parse(d))
      drafts.push(...produced)
      byDetector[detector.id] = produced.length
    } catch (err) {
      byDetector[detector.id] = 0
      console.error(`detector ${detector.id} failed:`, err)
    }
  }

  const scored = drafts.map((draft) => ({ draft, breakdown: score(draft, config) }))
  const nonBlockers = scored.filter((s) => !s.draft.isBlocker).map((s) => s.breakdown.rawScore)
  const bounds = {
    min: nonBlockers.length ? Math.min(...nonBlockers) : 0,
    max: nonBlockers.length ? Math.max(...nonBlockers) : 1,
  }

  await prisma.opportunity.deleteMany({ where: { snapshotId } })

  for (const { draft, breakdown } of scored) {
    await prisma.opportunity.create({
      data: {
        domain: snapshot.domain,
        snapshotId,
        type: draft.type,
        detectorId: draft.detectorId,
        detectorVersion: draft.detectorVersion,
        title: draft.title,
        subject: draft.subject,
        evidenceIds: draft.evidenceIds,
        impact: breakdown.impact,
        confidence: breakdown.confidence,
        fit: breakdown.fit,
        tacticPrior: breakdown.tacticPrior,
        effort: breakdown.effort,
        rawScore: breakdown.rawScore,
        priority: toPriority(
          breakdown.rawScore,
          draft.isBlocker,
          draft.impactInputs.coverage,
          bounds,
        ),
        isBlocker: draft.isBlocker,
      },
    })
  }

  return {
    snapshotId,
    opportunities: scored.length,
    blockers: scored.filter((s) => s.draft.isBlocker).length,
    byDetector,
  }
}

/** The suggested action travels with the draft; actions are created in the make stage. */
export function draftsForSnapshotInput(input: Parameters<Detector['run']>[0]): OpportunityDraft[] {
  return DETECTORS.flatMap((d) => d.run(input))
}
