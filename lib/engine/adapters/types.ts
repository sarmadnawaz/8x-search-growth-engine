import type { PropertyConfig } from '../../schemas'
import type { EvidenceInput } from '../../schemas'

/** A crawled page, written as a Page row alongside its Evidence. */
export interface PageInput {
  url: string
  status: number
  indexable: boolean
  title?: string
  metaDescription?: string
  h1?: string
  canonical?: string
  robotsMeta?: string
  schemaTypes: string[]
  internalLinks: number
  wordCount: number
  rawTextLength: number
}

export interface ClusterInput {
  market: string
  query: string
  intent: string
  demand: number
  demandSource: 'measured' | 'modeled'
}

export interface CollectResult {
  evidence: EvidenceInput[]
  pages?: PageInput[]
  clusters?: ClusterInput[]
}

export interface AdapterContext {
  config: PropertyConfig
  snapshotId: string
  /** live hits the network and writes fixtures; replay reads fixtures only */
  mode: 'live' | 'replay'
  /** resolved base URL — a local fixture server for properties we control */
  baseUrl: string
  /** clusters discovered earlier this run, so SERP sampling has something to sample */
  clusters: ClusterInput[]
  log: (message: string) => void
  record: (call: {
    adapter: string
    requestKey: string
    status: string
    cached: boolean
    latencyMs: number
  }) => Promise<void>
}

export interface Adapter {
  name: string
  /**
   * Why an adapter can't run live (missing key, no seed queries). Returning a
   * reason does not fail the run — the snapshot is marked degraded for this
   * adapter and detectors treat its evidence family as carried-forward/absent.
   */
  unavailableReason(ctx: AdapterContext): string | null
  collect(ctx: AdapterContext): Promise<CollectResult>
}
