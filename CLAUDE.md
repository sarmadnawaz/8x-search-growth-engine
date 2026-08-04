# 8x Search Growth Engine — working conventions

## Commands
- `npm run dev` — app + dashboard on http://localhost:3000 (seeded SQLite; no keys needed for browsing)
- `npm run pipeline -- <domain>` — run the full loop for one property
- `npm run pipeline -- <domain> --replay` — same, from cached API fixtures (no network, no keys)
- `npm run check:onboarding` — fails if adding a property touched anything under `lib/engine/`

## Architecture rules (enforced, not aspirational)
- Property-specific facts live ONLY in `properties/*.yaml`. `lib/engine/` must never reference a concrete domain.
- Analysis code writes `Evidence` rows; it never writes recommendations. Detectors (pure functions in `lib/engine/detectors/`) turn evidence into `Opportunity` rows. Scores come from the formula in `lib/engine/scoring.ts` — never from an LLM.
- Every adapter caches raw API responses to `fixtures/` on first success; `--replay` reads the cache. Mocked adapters must set `source_mode: fixture` on every row they emit — the UI renders the tier; never fake a `measured` tier.
- Actions carry machine-checkable acceptance criteria; only the verify pass (re-crawl) may flip status to `verified`.
- LLM calls: Haiku 4.5 for extraction/classification, Sonnet 5 for drafts, Opus 5 for rationale/evaluation — all via `messages.parse` with Zod schemas from `lib/schemas.ts`.

## Style
- TypeScript strict; no `any` in `lib/engine/`.
- Zod schemas are the single source of truth for entity shapes (DB, LLM outputs, UI props import from `lib/schemas.ts`).
- Commit after each working block (adapter, detector, surface) — reviewers read the history.
