# 03 — Build plan: the vertical slice, boxed to the hours that actually remain

*The 24-hour window covers everything: research, docs, mock-ups, and build. Decomposition, the research fan-out, five documents, the mock-up, and two adversarial review passes consumed roughly 9–10 of those hours. This plan boxes the build to the **~12 hours that remain** — a smaller honest plan beats a fantasy 24. Scope rule: build the thinnest path that proves the loop end-to-end, twice, with one live config-only domain add and one genuinely verified action.*

---

## 1. What the slice must demonstrate (maps to requirements in doc 00)

1. `cherly.app` and `pocketpal.me` run through the identical pipeline from two YAML configs (R1, R7).
2. Every opportunity row click-through ends at raw evidence JSON with source + fetch timestamp + confidence tier (R2).
3. One action completes the full lifecycle **honestly**: proposed → approved → executed → verified by re-check. Since we can't deploy to 8x's domains, the executed→verified steps run on a **fixture property we control** (a tiny static site served by the app itself, or a 30-minute Vercel deploy) — the engine detects its missing robots/sitemap, generates the fix, the fix is applied, and the re-crawl genuinely flips the status. cherly.app's identical real finding stays at `proposed`, with the generated robots.txt + sitemap.xml attached as reviewable artifacts (R3). *The verification gate refusing to lie is the demo.*
4. Generated assets that are artifacts, not just documents-about-artifacts: the fixture's **robots.txt + sitemap.xml** (applied), a **comparison-page draft** in MDX with citations resolving to evidence rows; free-tool *spec* as a third, stretch (R4).
5. Dashboard shows ≥2 dated snapshots per domain, diffs them ("what changed"), renders the trend, and labels seeded history as seeded (R5, R6).
6. `sway.day` added by config only — run **the first time the pipeline completes end-to-end**, re-run for the screenshot later; zero code diff (R7 — the acceptance test, never parked behind overrunnable blocks).
7. The AI-answer probe runs for real (Perplexity, search-grounded, citations) plus AIO presence via SerpAPI, so GEO/AEO is data in the system, not a slide (R8).

## 2. Stack (decision log)

| Choice | Decision | Rejected alternative & why |
|---|---|---|
| App | **Current stable Next.js (App Router) + TypeScript, single app** | FastAPI + React split: two runtimes, two installs, CORS, duplicated types — all cost, no benefit at this scale. Also: 8x's public stack is Next.js/Vercel — the slice should read as native |
| DB | **SQLite via Prisma, seeded DB committed** (`prisma db seed`; Postgres is the production target behind the same schema — full factor analysis in doc 05) | Postgres/Supabase: reviewer must run infra; SQLite keeps `npm install && npm run dev` true with zero keys. Drizzle: lighter, but Prisma wins on maturity + community + team familiarity |
| Schemas | **Zod end-to-end** — Zod validates LLM structured outputs (`messages.parse`) and UI props; Prisma types the DB layer; they meet in `lib/schemas.ts` | Untyped JSON between stages: exactly how evidence-less recommendations sneak in |
| Jobs | **`runs` table in SQLite, in-process; static "last run" summary in UI** | Redis/queue: unjustified; live 2s-polling progress UI: cut for time (below) |
| Charts | **Recharts** | visx/Nivo: power we don't need |
| LLM | **Anthropic SDK, tiered:** Haiku 4.5 ($1/$5) extraction/classification · Sonnet 5 ($2/$10 intro) drafts · Opus 5 ($5/$25) rationale + evaluator | One-model-everywhere: Opus prices for extraction or Haiku quality on strategy. Demo run <$1; production: Batch API −50% |
| Crawler | **fetch + cheerio, polite** (robots-respecting, ~1 req/s, identified UA, ~30 pages/domain) | Playwright: only needed for JS rendering; the no-JS fetch doubles as the AI-crawler parity check |
| Resilience | **Every adapter caches raw responses to `fixtures/` on first success; `--replay` re-runs from cache** | Praying the live APIs work during review. Replay is also the reviewer's no-keys path, and protects the finite Serper credits from dev-iteration burn |

## 3. Hour-boxed plan (~12h remaining)

| Hours | Block | Output |
|---|---|---|
| 0–1 | **All API signups in parallel** (GCP/PSI, Serper, SerpAPI, Perplexity, Anthropic — the plan's five keys) while scaffolding: repo, Next.js, Prisma schema + migrate, Zod entities, three property YAMLs + fixture-property config | Schema compiles; configs validate; keys in `.env` |
| 1–4 | Core adapters, caching-first: crawler (robots, sitemap, canonicals, meta, JSON-LD, no-JS parity), PSI, autocomplete, Serper; mocked `gsc`/`volume` behind the same interface. CrUX + OpenPageRank: interface + fixtures only (design-documented, not demo-critical — CrUX would only say "below threshold" for these domains) | Real evidence rows for both 8x domains + fixture; snapshot #1 |
| 4–5 | AI probe (Perplexity, grounded, citations → inclusion rate) + AIO check (SerpAPI) | `ai_answer_probe` evidence — R8 real |
| 5–7 | Detectors ×4 (true-blocker class, meta/canonical + robots/sitemap hygiene, cluster SERP gap, AI-citation absence) + scoring formula + 20–89/90–100 priority mapping. Portfolio arbitration: **design-only** (doc 02 §13) | Prioritised target list, every number derivable |
| 7–8 | Actions + acceptance checks + comparison-draft maker (Haiku/Sonnet chain, QA gates, review queue) | Draft asset traceable to its opportunity |
| 8–9 | **The two demo moments:** fixture property fix applied → re-crawl → `verified` flips for real; `sway.day` config-only add runs the full pipeline | R3 and R7, honestly closed |
| 9–11.5 | Dashboard, three surfaces built from the mock-up's HTML: property view (loop, tiles, trend), target list + evidence drawer, action detail. Portfolio view + live run-progress: cut | The mock-up, made real where it counts |
| 11.5–12 | Snapshot #2 + diff seeded; status flip across README, doc 00 §5, and doc 06 §8 (only now do "working slice" claims become present-tense); commit history tidy | Reviewer-runnable, claims true |

## 4. Runtime de-scope order (what drops when a block overruns)

In order: **(1)** second asset maker (tool spec) → **(2)** detector #4 (AI-citation absence) → **(3)** AIO adapter (keep Perplexity probe) → **(4)** autocomplete expansion breadth (seeds only) → **(5)** trend chart (table of snapshot numbers instead) → **(6)** pocketpal.me as second live domain (fixture property covers the two-config proof).
**Never cut:** seeded DB · the fixture verified action · the sway.day config-only add · evidence click-through · honest status labels.

## 5. Honest-limits section (goes in the README verbatim)

- **We cannot execute on domains we don't own.** 8x-domain findings are detection + generated fix artifacts at `proposed`; the executed→verified lifecycle is demonstrated on a fixture property we control. Nothing is ever displayed as verified that a `curl` would falsify.
- SEO outcomes lag 2–6 months; the demo proves the *plumbing* (baselines, diffs, verification, windows), not uplift. Verdicts at day-N read `too_early` until their windows pass; seeded history is labelled seeded.
- Search volume is `modeled` (autocomplete richness), confidence-capped and displayed as such; production swaps in DataForSEO behind the same adapter.
- The autocomplete endpoint is undocumented/gray and can rate-limit from datacenter IPs; every adapter's `--replay` mode is the fallback, and production replaces gray dependencies with contracted APIs (named per adapter in doc 02 §10).
- AI answers are non-deterministic; AI-visibility is an inclusion *rate* over samples (Wilson-bound confidence), never single-shot presence. "AIO not served to this client" is recorded explicitly, not conflated with "not cited."
