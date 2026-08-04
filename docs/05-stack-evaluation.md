# 05 — Stack evaluation: factor-scored, not vibes

*Method: every layer was selected against the same eight factors, scored per candidate (✔ strong · ~ adequate · ✘ weak), then weighted by this system's actual workload. The workload shapes the weights, so it goes on record first.*

**Workload profile:** I/O-bound (crawling, API polling, LLM calls — almost zero CPU-bound compute) · small data (tens of thousands of rows/day even at 100 domains) · nightly batch cadence, not request-driven load · read-mostly dashboard · correctness of typed data crossing many seams (adapters → engine → LLM → UI) is the dominant defect risk · one engineer now, small team later.

**Factors:** (1) scalability for *this* workload shape · (2) reliability & maturity (battle-tested, known failure modes) · (3) community & ecosystem (library depth, issue-search density, longevity risk) · (4) hiring pool · (5) performance on the workload · (6) operational cost/complexity · (7) type-safety across seams · (8) team/company fit + exit cost if we're wrong.

---

## 1. Runtime + framework — Next.js/Node vs FastAPI/Python vs Go

| Factor | **Next.js (Node/TS)** | FastAPI (Python) | Go (chi/echo + React) |
|---|---|---|---|
| Scalability (I/O-bound) | ✔ event-loop concurrency is the native model for thousands of in-flight fetches | ✔ asyncio equivalent for I/O (GIL irrelevant here) | ✔ goroutines, best raw ceiling |
| Reliability/maturity | ✔ Node 15+ yrs in prod; App Router churn is real — pinned versions mitigate | ✔ mature | ✔ exemplary stability |
| Community/ecosystem | ✔ npm is the largest registry; every SaaS API has a first-party JS SDK | ✔ strongest *data/SEO* tooling (advertools, pandas) | ~ smaller web/LLM ecosystem |
| Hiring pool | ✔ largest combined pool (JS+TS) | ✔ large | ~ smaller, pricier |
| Performance (this workload) | ✔ bottleneck is polite-crawl rate limits, not runtime | ✔ same | ✔ overkill — wins a race we're not running |
| Ops cost | ✔ one runtime, one deploy | ✘ two runtimes (Python API + JS dashboard), CORS, duplicated types | ✘ two runtimes |
| Type-safety across seams | ✔ **one type system end-to-end**: Zod schemas validate engine entities, LLM structured outputs, and UI props — the seam-drift defect class is removed by construction | ~ Pydantic is excellent but the API↔UI boundary reintroduces contract drift | ~ strong in Go, but the boundary problem remains |
| Fit + exit | ✔ 8x runs Next.js/Vercel; exit = engine is a plain TS package, portable to any Node host | ~ | ~ |

**Decision: Next.js + TypeScript.** Go wins raw performance we don't need; Python wins data-tooling we can replace with ~200 lines over HTTP APIs. The deciding factors are ops cost and the eliminated seam-drift class — in a system whose whole pitch is *typed evidence flowing through many stages*, factor 7 carries the most weight.
**Flips the decision:** a Python-native team (Pydantic + FastAPI then wins on factor 8), or a crawler requiring distributed headless rendering from day one (Go/worker-fleet territory).

## 2. Database — SQLite (slice) → Postgres (production), decided as a pair

| Factor | SQLite | **Postgres** | MySQL | MongoDB |
|---|---|---|---|---|
| Scalability | ~ single-writer, single-node (volume is a non-issue: handles 100s of GB) | ✔ concurrent writers, replicas, partitioning | ✔ comparable | ✔ horizontal, but we don't shard |
| Reliability/maturity | ✔ most-deployed DB on earth; ACID; WAL | ✔ the reference standard; PITR, replication | ✔ mature | ~ historically weaker consistency defaults |
| Community/ecosystem | ✔ enormous | ✔ enormous + extension ecosystem | ✔ large | ✔ large |
| Fit for the data model | ✔ relational joins = the target-list view | ✔ same, **plus `jsonb`** for raw evidence payloads with indexing | ~ weaker JSON story | ✘ evidence↔opportunity↔action is join-shaped; document model fights it |
| Ops cost | ✔ zero — it's a file; the **committed seed DB** gives reviewers a populated dashboard with no infra | ~ a managed instance to run and pay for | ~ same | ~ same |
| Topology | ✘ embedded — dies the moment dashboard and workers are separate services | ✔ client-server, made for that shape | ✔ | ✔ |

**Decision: SQLite in the slice, Postgres in production — explicitly as a migration pair.** On pure factors Postgres wins; the *slice's* topology (single process, reviewer-runs-it) inverts the ops-cost weighting. The trigger for migration is **topology, not load**: the day the pipeline moves out of the web process, SQLite is structurally impossible, and that day is already scheduled in the production design.
**Flips the decision:** nothing flips Postgres as the production target; Mongo would only win if evidence were schema-chaotic — it isn't, it's Zod-typed.

## 3. Data-access layer — Prisma vs Drizzle vs raw SQL

| Factor | **Prisma** | Drizzle | raw SQL |
|---|---|---|---|
| Community/maturity | ✔ largest ORM community by far; a decade of production miles; issue-search density unmatched | ~ younger project, smaller corpus | ✔ eternal |
| Type generation | ✔ schema-first with a generated, fully-typed client; migrations built in (`prisma migrate`) | ✔ types flow from schema, no codegen step | ✘ hand-maintained |
| Transparency | ~ client-layer indirection (mitigated: modern Prisma dropped the Rust query engine for a TS client + driver adapters, and raw SQL escape hatches exist) | ✔ queries read as SQL | ✔ total |
| Dialect portability | ✔ SQLite ↔ Postgres behind one schema — **the pre-paid exit** — plus `prisma db seed` for the committed demo DB | ✔ same | ~ dialect drift is on you |
| Team familiarity | ✔ the tool I can defend and extend live | ~ | ~ |

**Decision: Prisma.** The factor that decides is a compound of **maturity + community + familiarity**: in a system whose data layer must be boringly reliable while the interesting risk lives in the engine, the largest-community ORM that the team already knows beats a thinner, prettier one. Priced trade-off, stated: Drizzle is lighter and more SQL-transparent — if profiling ever shows the client layer mattering, the entities are Zod-defined and the queries are simple joins, so the exit is cheap in either direction. (Drizzle was the original draft pick on the transparency factor; re-weighted in review — familiarity is a legitimate factor when the author must live-extend the code.)

## 4. Supporting choices, same discipline (abbreviated)

| Layer | Pick | Runner-up & why it lost |
|---|---|---|
| Charts | **Recharts** (~50M weekly downloads, maintained, SVG/React-native API) | visx (power we don't need, steeper curve) · Nivo (bundle size) |
| Schemas | **Zod** (de-facto standard; validates LLM structured outputs and UI props; Prisma types the DB layer — the two meet in `lib/schemas.ts`) | — |
| Jobs | see §4a — decided in three stages by scale | — |
| LLM | **A narrow in-house provider seam** (`grounded answer` + `schema-constrained object`), implemented against OpenAI's Responses API with `web_search`. Grounding is the deciding requirement, not the vendor: properties younger than a model's training cutoff can only be cited if the model actually searches | A vendor SDK used directly (locks the call shape to one provider for no gain at two methods) · a general abstraction layer such as the AI SDK (more surface than two methods justify). Model tiering — cheap for extraction, mid for drafting, top for evaluation — is a routing policy *inside* a provider, so it survives the swap |

## 4a. Jobs / scheduling — decided in three stages, because "best" changes with scale

What the jobs layer must do here: nightly per-property pipeline runs (multi-minute, I/O-bound, rate-limit-paced) · retries with backoff · scheduled re-measurement · human review gates that pause work for hours-to-days · long timers (2–12 week measurement windows).

| Factor | In-process `runs` table | **pg-boss / Graphile Worker** | BullMQ | Temporal | Inngest / Trigger.dev (managed) |
|---|---|---|---|---|---|
| New infra required | none | **none** (lives inside Postgres) | Redis | Temporal cluster (or paid cloud) | none (SaaS dependency) |
| Reliability semantics | ✘ dies with the process | ✔ transactional enqueue — job and data commit atomically, no dual-write problem | ✔ solid, at-least-once | ✔ gold standard: durable, replayable | ✔ durable steps |
| Long timers / human-in-loop | ✘ | ~ workable (scheduled polls) | ~ | ✔ native (weeks-long sleeps are first-class) | ✔ native |
| Scale ceiling | one process | thousands of jobs/min — far above our nightly-batch reality | very high | effectively unlimited | high |
| Ops/complexity cost | none | low | medium | **high** — a platform, not a library | low, but vendor lock + data egress |
| Community | — | solid, Postgres-native niche | ✔ largest Node queue | ✔ large, growing | growing |

**Decision, staged with named triggers:**
1. **Slice: the `runs` table, in-process.** Any queue is infrastructure the reviewer must run; at demo scale a queue is cosplay.
2. **Production v1: pg-boss.** The moment workers split from the dashboard we're on Postgres anyway — pg-boss gives retries, cron, and **transactional enqueue** (a pipeline result and its follow-up job commit in one transaction — a correctness property Redis-backed queues can't give you) with *zero* new moving parts. BullMQ loses purely on the Redis tax: never buy a second datastore for throughput you don't have.
3. **Production v2: Temporal — trigger, not date.** Adopt when the workflows themselves become the complexity: multi-week measurement timers, human approval gates inside a durable run, replay/debugging of long pipelines across deploys. That's a real future for this engine, which is why it's named — but running a Temporal cluster for nightly batches at 20 domains is the over-engineering the CTO lens would flag. Managed middle path (Inngest/Trigger.dev) if the team prefers buying durability over operating it.

## 4b. Cost model — everything, priced

Three cost categories, because dollars are the smallest one: **(a) infrastructure + API dollars, (b) engineering/ops hours** (an hour of engineer time ≈ a month of the entire API budget — the dominant real cost), **(c) friction costs** (reviewer minutes now; migration/exit costs later).

### Dollars, by scale

| Line item | Slice (3 domains) | Production 21 domains, nightly | 100 domains, nightly |
|---|---|---|---|
| Hosting (app + worker) | $0 (local) | $6–25/mo — one small VPS, or Vercel + a worker box; 8x already pays for Vercel/Supabase, so realistically **$0 incremental** | ~$50/mo |
| Database | $0 — SQLite file | $0–25/mo (Supabase/Neon tier they already have) | $25–50/mo |
| SERP tracking (30 q/domain/day, the config knob) | $0 (free credits) | $12–19/mo | $55–90/mo |
| Volume refresh (monthly, DataForSEO) | $0 (mocked) | $1–2/mo | $5–10/mo |
| PSI / CrUX / GSC / KG APIs | $0 | $0 (free quotas cover this scale) | $0 |
| AI-visibility probes (weekly panels) | pennies | $2–8/mo | $10–30/mo |
| LLM pipeline (changed-pages only, Batch −50%, prompt-caching ≈90% off repeated context) | <$1 total | $10–30/mo | $50–150/mo |
| **Total** | **≈ $0** | **≈ $30–90/mo** | **≈ $200–330/mo at this table's minimal cadence** |

*This table prices the slice's minimal workload (30 queries/domain, 1 market, monthly volume refresh). The production-scale model — mature multi-market properties at ~100 queries × 2.5 markets weekly plus 15 assets/month — runs ≈$12–15/domain/month (~$1.2–1.5k/mo at 100 domains, $5–10k/mo at 500): full arithmetic, and why the step-costs are human rather than infrastructural, in doc 06 §5. Both models key on the same config knobs (queries × markets × cadence); the spread between them is the dial, not a disagreement.*

**The benchmark that gives these numbers meaning:** one Ahrefs/Semrush seat runs $100–500/mo, Profound starts ~$499/mo, BrightEdge-class contracts are $40k+/yr. At 100 domains this engine's entire run cost is **~1% of an enterprise SEO contract** — and unlike a seat, it scales per-domain by a config knob (queries/domain/day), so cost is a dial we set, not a tier we're sold.

### Cost of the rejected alternatives (why the cost lens confirms the stack)

| Alternative | Dollar delta | Real cost |
|---|---|---|
| FastAPI + React split | ~$0 | a second deploy target, CI pipeline, and type-contract maintenance — recurring engineering hours forever, the most expensive currency |
| Postgres from day one in the slice | $0 (free tiers) | reviewer friction — the take-home's scarcest resource is reviewer minutes |
| BullMQ | +$5–15/mo managed Redis | plus operating a second datastore for throughput we can't name a consumer for |
| Temporal (self-hosted / Cloud) | ops hours / ~$100s per mo | a platform's learning + operating curve bought years before the durable-workflow trigger fires |
| Commercial AI-visibility SaaS (Profound/Peec/Otterly) | $200–500+/mo | replaced in the slice by a DIY probe costing pennies; revisit only when panel scale outgrows DIY |
| Opus-for-everything LLM usage | ~5–10× the pipeline line | tier discipline (Haiku extract / Sonnet draft / Opus judge) + Batch + caching is an ~80–90% cost reduction with no quality loss where it matters |

### The cost that dominates all of it

At every scale above, the largest line isn't in the tables: **human review time** on generated assets (the publishing gate is deliberate policy, not a bottleneck bug). The engine's cost job is to make each review minute count — evidence attached to every recommendation means approve/reject in seconds, not research. That's also the honest answer to "why build this at all": the engine's ~$50/mo replaces not a tool seat but the *research hours* that produce evidence — the one input 8x can't buy at scale.

## 5. The weighting argument (why factor lists alone don't pick)

All finalists above are "scalable" and "reliable" in the abstract — top-tier tools cluster at ✔ on generic factors, which is precisely why stack debates go in circles. Selection happens in the **weights**, and weights come from the workload: this system is I/O-bound, small-data, batch-cadence, seam-heavy. That profile promotes type-safety-across-seams and ops-cost to deciding factors and demotes raw performance to irrelevant. The record above exists so that when the workload changes — and §2 and §4 name the exact triggers — the re-decision is a table update, not an argument.
