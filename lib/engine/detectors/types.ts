import type { Evidence, Page, QueryCluster } from '@prisma/client'
import type { OpportunityDraft, PropertyConfig } from '../../schemas'

/**
 * A detector is a pure function over collected evidence.
 *
 * Deliberately mechanical, in the shape Ahrefs' Opportunities report uses: a
 * filter that either matches or does not. Because the filter is the reason the
 * row exists, evidence comes attached by construction rather than being
 * retrofitted as justification — which is the failure mode of tools that
 * recommend first and explain later.
 */
export interface DetectorInput {
  config: PropertyConfig
  evidence: Evidence[]
  pages: Page[]
  clusters: QueryCluster[]
}

export interface Detector {
  id: string
  version: string
  description: string
  run(input: DetectorInput): OpportunityDraft[]
}

/** Evidence value payloads are stored as JSON; read them with the kind in hand. */
export function value<T>(row: Evidence): T {
  return row.value as T
}
