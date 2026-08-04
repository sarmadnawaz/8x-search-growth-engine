import { EFFORT_WEIGHT, TIER_WEIGHT, type OpportunityDraft, type PropertyConfig } from '../schemas'

/**
 * Scoring is deterministic and computed in code from stored evidence.
 *
 * No LLM assigns a priority here. An LLM-assigned number cannot be recomputed,
 * cannot be argued with, and is the clearest tell that a system is generating
 * plausible-looking output rather than analysis. Every factor below is stored
 * on the Opportunity row so the UI can show the breakdown and a reviewer can
 * redo the arithmetic by hand.
 *
 *   score = impact x confidence x fit x tacticPrior / effort
 *
 * `impact` is defined per opportunity type — a citation gap has no SERP
 * position to gain, so scoring it with a click-through curve would be
 * meaningless.
 */

export interface ScoreBreakdown {
  impact: number
  confidence: number
  fit: number
  tacticPrior: number
  effort: number
  rawScore: number
}

/** Click-through weight by position. Used for headroom, not for traffic estimates. */
function ctrAt(position: number): number {
  if (position <= 1) return 0.28
  if (position <= 3) return 0.15
  if (position <= 5) return 0.08
  if (position <= 10) return 0.03
  return 0.005
}

/**
 * Headroom between where a property ranks now and where it could realistically
 * rank. "Realistically" matters: a domain launched weeks ago cannot be scored
 * as though position 1 were available to it, so achievable position is bounded
 * by the authority signal rather than assumed.
 */
export function headroom(currentPosition: number | null, achievablePosition: number): number {
  const current = currentPosition ?? 30
  if (current <= achievablePosition) return 0
  const gain = ctrAt(achievablePosition) - ctrAt(current)
  return Math.max(0, Math.min(1, gain / ctrAt(1)))
}

function impactFor(draft: OpportunityDraft, config: PropertyConfig): number {
  const i = draft.impactInputs

  switch (draft.type) {
    case 'technical': {
      // Coverage x severity class. A true indexation blocker is not the same
      // thing as a missing meta description, and the severity weight is what
      // keeps hygiene work from impersonating an emergency.
      return i.coverage * i.severity
    }
    case 'geo_aeo': {
      // No SERP position exists for "we are absent from AI answers", so impact
      // is demand x how much citation share is unclaimed.
      return i.demand * i.citationHeadroom
    }
    case 'authority': {
      return i.demand * i.coverage
    }
    default: {
      // keyword / content / competitor: demand x position headroom, discounted
      // when an AI Overview absorbs the clicks this ranking would have won.
      const aiDiscount = i.aiOverviewPresent ? 0.5 : 1
      return i.demand * i.headroom * aiDiscount
    }
  }
}

/**
 * Wilson lower bound: an inclusion rate observed over 5 samples is not as
 * certain as one observed over 100. Probe evidence is discounted accordingly
 * instead of being treated like a deterministic HTTP status code.
 */
export function wilsonLowerBound(successes: number, total: number, z = 1.96): number {
  if (total === 0) return 0
  const p = successes / total
  const denominator = 1 + (z * z) / total
  const centre = p + (z * z) / (2 * total)
  const margin = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))
  return Math.max(0, (centre - margin) / denominator)
}

export function score(draft: OpportunityDraft, config: PropertyConfig): ScoreBreakdown {
  const impact = impactFor(draft, config)

  // Confidence answers "is this datum true", and nothing else. The weakest
  // load-bearing datum sets the tier; agreement between independent sources
  // raises it; small-sample probe evidence discounts it.
  const agreement = Math.min(1.5, 1 + 0.25 * (draft.sourceCount - 1))
  const confidence = TIER_WEIGHT[draft.weakestTier] * agreement * draft.sampleDiscount

  // Fit is per-property policy from config: what this property is actually for.
  const fit = draft.intent ? (config.fitWeights[draft.intent] ?? 1) : 1

  // The learn-loop prior lives here rather than inside confidence, so that
  // "how sure are we of the fact" and "does this tactic tend to pay off" stay
  // separately visible. Defaults to 1.0 until outcomes exist.
  const tacticPrior = 1

  const effort = EFFORT_WEIGHT[draft.effortClass]
  const rawScore = (impact * confidence * fit * tacticPrior) / effort

  return { impact, confidence, fit, tacticPrior, effort, rawScore }
}

/**
 * Raw scores are unbounded and only comparable within a run, so the displayed
 * 0-100 priority is a mapping, not a measurement:
 *
 *   - true blockers occupy 90-100, scaled by how much of the property they affect
 *   - everything else is min-max normalised into 20-89 within the snapshot
 *
 * Stated explicitly because "how did 1.17 become 43?" is exactly the question
 * a reviewer should be able to answer from the document.
 */
export function toPriority(
  raw: number,
  isBlocker: boolean,
  coverage: number,
  bounds: { min: number; max: number },
): number {
  if (isBlocker) return Math.round(90 + 10 * Math.min(1, coverage))
  if (bounds.max === bounds.min) return 55
  const normalised = (raw - bounds.min) / (bounds.max - bounds.min)
  return Math.round(20 + normalised * 69)
}
