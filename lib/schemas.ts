import { z } from 'zod'

/**
 * The single source of truth for entity shapes.
 *
 * These schemas validate three different boundaries with the same objects:
 * property config on load, adapter output before it becomes Evidence, and
 * LLM output before it becomes an Asset. Anything that cannot be validated
 * here does not enter the system.
 */

export const EVIDENCE_TIERS = ['measured', 'modeled', 'fixture'] as const
export type EvidenceTier = (typeof EVIDENCE_TIERS)[number]

/** Confidence multiplier per tier. A mocked adapter cannot claim certainty. */
export const TIER_WEIGHT: Record<EvidenceTier, number> = {
  measured: 1.0,
  modeled: 0.6,
  fixture: 0.3,
}

export const EVIDENCE_KINDS = [
  'crawl_fact',
  'serp_observation',
  'demand_signal',
  'competitor_fact',
  'ai_answer_probe',
  'authority_fact',
  'outcome_metric',
] as const

export const INTENTS = [
  'informational',
  'commercial',
  'transactional',
  'navigational',
  'tool_intent',
] as const

export const OPPORTUNITY_TYPES = [
  'technical',
  'keyword',
  'content',
  'competitor',
  'authority',
  'geo_aeo',
] as const

export const ACTION_STATUSES = [
  'proposed',
  'approved',
  'executed',
  'verified',
  'failed',
  'stopped',
] as const

// ---------------------------------------------------------------------------
// Property configuration — the only per-property surface. Adding a domain means
// adding one of these files; the engine never learns a domain name.
// ---------------------------------------------------------------------------

export const PropertyConfig = z.object({
  domain: z.string().min(3),
  name: z.string(),
  /// what the property is for, in plain language — used by asset makers
  description: z.string(),
  goal: z.string(),
  conversionRoute: z.string(),
  markets: z
    .array(
      z.object({
        market: z.string(), // gl, e.g. "us"
        language: z.string(), // hl, e.g. "en"
      }),
    )
    .min(1),
  competitors: z.array(z.string()).default([]),
  /// seed topics; the engine expands these into query clusters via autocomplete
  seedQueries: z.array(z.string()).default([]),
  /// buyer-intent prompts for the AI-visibility probe
  promptPanel: z.array(z.string()).default([]),
  contentTypes: z.array(z.string()).default([]),
  publishingPolicy: z.enum(['review_first', 'auto_low_risk']).default('review_first'),
  /// scoring weights: how much this property values each intent class
  fitWeights: z.record(z.number()).default({}),
  /// bare brand strings collide (Luma, Sway) — probe matching requires context
  entityCollision: z.boolean().default(false),
  crawl: z
    .object({
      maxPages: z.number().int().positive().default(30),
      requestsPerSecond: z.number().positive().default(1),
    })
    .default({ maxPages: 30, requestsPerSecond: 1 }),
  /// where the engine may actually deploy fixes; false for domains we don't own
  deployAccess: z.boolean().default(false),
  /// serve+crawl this property from a local directory instead of the public web.
  /// used by the fixture property, which is how the executed->verified lifecycle
  /// is demonstrated honestly (we cannot deploy to domains we don't control).
  localSite: z
    .object({ dir: z.string(), port: z.number().int().positive().default(3100) })
    .optional(),
})
export type PropertyConfig = z.infer<typeof PropertyConfig>

// ---------------------------------------------------------------------------
// Evidence payloads, one shape per kind.
// ---------------------------------------------------------------------------

export const CrawlFact = z.object({
  fact: z.string(), // e.g. "robots_txt_missing"
  url: z.string(),
  detail: z.record(z.unknown()).default({}),
})

export const SerpObservation = z.object({
  query: z.string(),
  market: z.string(),
  ownPosition: z.number().int().nullable(),
  topResults: z.array(z.object({ position: z.number().int(), url: z.string(), title: z.string() })),
  serpFeatures: z.array(z.string()).default([]),
  /// null means "we could not observe" — never conflated with "not present"
  aiOverviewPresent: z.boolean().nullable().default(null),
})

export const DemandSignal = z.object({
  query: z.string(),
  market: z.string(),
  suggestionCount: z.number().int(),
  suggestions: z.array(z.string()),
})

export const AiAnswerProbe = z.object({
  prompt: z.string(),
  engine: z.string(),
  samples: z.number().int(),
  mentions: z.number().int(),
  citedUrls: z.array(z.string()).default([]),
  /// Wilson lower bound of the inclusion rate: an n=5 probe is not a certainty
  inclusionLowerBound: z.number(),
})

export const AuthorityFact = z.object({
  metric: z.string(),
  value: z.number(),
  comparedTo: z.record(z.number()).default({}),
})

export const EvidenceInput = z.object({
  kind: z.enum(EVIDENCE_KINDS),
  source: z.string(),
  tier: z.enum(EVIDENCE_TIERS),
  subject: z.string(),
  value: z.unknown(),
  clusterId: z.string().optional(),
  rawRef: z.string().optional(),
})
export type EvidenceInput = z.infer<typeof EvidenceInput>

// ---------------------------------------------------------------------------
// Detector output. A detector may only emit these — it cannot invent a score.
// ---------------------------------------------------------------------------

export const OpportunityDraft = z.object({
  type: z.enum(OPPORTUNITY_TYPES),
  detectorId: z.string(),
  detectorVersion: z.string(),
  title: z.string(),
  subject: z.string(),
  evidenceIds: z.array(z.string()).min(1, 'an opportunity without evidence is an opinion'),
  isBlocker: z.boolean().default(false),
  /// per-type impact inputs; scoring.ts turns these into a priority
  impactInputs: z.object({
    demand: z.number().default(0),
    headroom: z.number().default(0),
    coverage: z.number().default(0),
    severity: z.number().default(0),
    citationHeadroom: z.number().default(0),
    aiOverviewPresent: z.boolean().default(false),
  }),
  intent: z.enum(INTENTS).optional(),
  effortClass: z.enum(['technical_fix', 'page_edit', 'new_page', 'data_page', 'free_tool']),
  /// the weakest load-bearing datum decides the confidence tier
  weakestTier: z.enum(EVIDENCE_TIERS),
  sourceCount: z.number().int().min(1).default(1),
  sampleDiscount: z.number().min(0).max(1).default(1),
  suggestedAction: z.object({
    kind: z.string(),
    title: z.string(),
    spec: z.string(),
    criteria: z.array(z.object({ id: z.string(), description: z.string(), check: z.string() })),
  }),
})
export type OpportunityDraft = z.infer<typeof OpportunityDraft>

export const EFFORT_WEIGHT: Record<OpportunityDraft['effortClass'], number> = {
  technical_fix: 1,
  page_edit: 2,
  new_page: 3,
  data_page: 5,
  free_tool: 8,
}

// ---------------------------------------------------------------------------
// Asset makers (LLM-backed stages) must return one of these.
// ---------------------------------------------------------------------------

export const GeneratedAsset = z.object({
  type: z.enum(['technical_fix', 'landing_page', 'comparison_page', 'blog', 'tool_spec']),
  path: z.string().optional(),
  body: z.string().min(1),
  /// claims the asset makes must resolve to evidence ids the action already carries
  citedEvidenceIds: z.array(z.string()).default([]),
})
export type GeneratedAsset = z.infer<typeof GeneratedAsset>
