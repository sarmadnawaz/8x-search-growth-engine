# 06 — Scale architecture: the same system at 500 domains

*The slice (doc 03) is stage 0 of this architecture, not a throwaway. This document is the thought process for what the system becomes as the portfolio grows — with the discipline that every escalation has an **observable trigger**, because premature architecture is just technical debt with better PR. A CTO shipping three apps a month punishes over-engineering as hard as under-engineering; this doc is written to survive both probes.*

---

## 1. What "scale" means here (it is not user traffic)

This is a **batch evidence system**, not a consumer app. Its scale axes:

| Axis | Today | 2–3 years, plausible | Pressure it creates |
|---|---|---|---|
| Properties | ~13–20 | 100–500 | fleet scheduling, config governance, fair resource sharing |
| Markets/languages per property | 1–2 | 5–10 | query universes multiply; per-market SERP sampling |
| Tracked queries per property | 30 | 100–300 | SERP API volume — the dominant variable cost |
| Snapshot history | days | years, immutable, never deleted (GSC deletes its own at 16 mo — we are the system of record) | storage growth, time-series query shape |
| Generated assets | a few/week | ~15/domain/month → thousands/month fleet-wide | human-review throughput becomes the bottleneck |
| Team | 1 engineer | growth pods + platform owner | the engine becomes an internal platform |

Requests-per-second never appears in that table. The dashboard is read-mostly over small hot data; the hard problems are **fleet scheduling, time-series growth, third-party quota management, and review throughput**.

## 2. Load math at 500 domains — the arithmetic that disciplines everything else

Worst case, 500 domains × 5 markets × 100 queries, daily — deliberately *above* §1's plausible envelope: if the numbers close here, they close everywhere below it. That gives **250k SERP samples/day** (~91M/yr; ~912M exploded top-10 position rows/yr), **50k crawled pages/week**, **~1M non-SERP evidence rows/week** (serp_observation/rank_position counted separately above). Storage: **≈150–400 GB/yr of relational data + 250–500 GB/yr of raw blobs**. Write load: ~30–60 inserts/s average (batched COPY territory). Verdict with receipts: this is *mid-size, not big* — Postgres's per-table limit is 32 TB, OpenAI serves over a million QPS for 800M users from a **single unsharded Postgres primary** + read replicas (PGConf.dev 2025), and MotherDuck's data shows the median org's entire analytic dataset is ~100 GB. **The binding constraint at scale isn't the database — it's the SERP API bill**: 250k calls/day ≈ **$4.5k/mo at DataForSEO's $0.60/1k standard queue** (the rate this plan assumes throughout; generic live/list rates of $1–3/1k would make it $7.5–23k/mo), which is why observation *cadence* is a first-class schema attribute (head terms daily, tail weekly — cutting all figures 3–7×, to ~$0.7–1.5k/mo) and SERP fetches dedupe portfolio-wide by `(query, market, device, date)` so three finance apps tracking "budgeting app" cost one fetch. The architecture therefore invests in **scheduling, idempotency, and governance** — not distributed storage it will never need.

## 3. Storage evolution

**Postgres, partitioned from v1 where it's free.** The 3–4 append-only time-series tables get monthly range partitions at schema creation — 36 per table over 3 years, ~110–145 across all of them, vs the measured ~5,000-partition planning-time ceiling (depesz.com) — so cost ≈ 0 now and partition-drop becomes the retention mechanism (instant, no VACUUM debt). Physical↔logical mapping, stated: high-volume Evidence kinds (serp_observation, and its exploded rank_position child) get dedicated physical tables; **Evidence remains the logical interface from doc 02 §2**. Partition DDL and COPY ingest live in hand-written SQL inside `prisma migrate`'s customized migrations — Prisma's DSL doesn't express partitioning, so it types the read/query layer while migrations own the physical schema. Everything else (properties, opportunities, actions — low-millions of rows) stays unpartitioned indefinitely.

**Raw payloads never enter Postgres.** TOAST makes >2 KB jsonb reads 2–10× slower (measured, evanjones.ca); rule: rows hold only fields a SQL predicate will ever touch; full SERP envelopes, PSI JSON, probe responses, and all crawled HTML go to object storage (R2/S3, zstd, keyed `property/source/date/sha256`; structured payloads additionally land as date-partitioned parquet) with pointer + hash in the row. At ~$7.50/TB/mo after ~2:1 zstd (R2 list $15/TB/mo, zero egress) this is a non-decision — and the archive is the **replay path that turns Evidence schema migrations into recompute jobs** instead of data migrations.

**Single-instance ceiling & triggers:** one 8–16 vCPU/64 GB instance carries the 500-domain load. PgBouncer in transaction mode when concurrent connections pass ~50–100 (pg-boss polls, so it tolerates transaction pooling; only a LISTEN/NOTIFY-based worker like Graphile Worker would need a direct session); one read replica when ingest-window p95 dashboard latency doubles vs baseline. Sharding: **no observable trigger exists within this plan.**

**OLAP escalation ladder** — each step only on its trigger: (0) per-property dashboards prune to thousands of rows via one composite BTree `(property_id, market, query_id, observed_at DESC)` — ms forever; (1) cross-portfolio analytics → nightly rollup tables; (2) analyst queries over full history → **DuckDB over the parquet archive we already write** — zero new infra; (3) **ClickHouse** only when a rollup-backed query still exceeds ~5s p95 or scans >100M rows post-pruning. ClickHouse is the honest endgame precedent — SEMrush and Ahrefs both run on it — but they operate at 100–1000× our observation volume, so *vendor precedent alone is explicitly not a trigger* (PostHog's Postgres→ClickHouse move happened at event volumes we'd never reach). BigQuery appears solely as the GSC Bulk Export landing zone.

**Retention:** 16 hot months (matches GSC's window, covers year-over-year with margin), then checksum-verified parquet export → daily rollup row → partition drop. Steady-state Postgres stabilizes at ~200–500 GB.

**Trigger-less v1 obligations (the only items where waiting is irreversible):** ① enable **GSC Bulk Export to BigQuery the day each property's verification lands** — the export is forward-only and GSC deletes at 16 months, so every unexported day is permanently lost; ② archive every raw API payload from day one; ③ stamp every Evidence row with `detector_id, detector_version, schema_version, engine_git_sha` — immutable rows, new versions write new rows, so a v3 "thin-content" detection never silently poisons priors computed on v1 semantics; ④ **market is a first-class key** `(property_id, market, query_id)` on every fact table — TR/BR query universes overlap <50%, and locale-aware normalization matters concretely (Turkish dotted/dotless-i breaks naive lowercase dedupe in a priority market).

## 4. Pipeline fleet & reliability

**The queue is never the bottleneck — vendors are.** Fleet load at 500 domains ≈ 300–500k jobs/night ≈ 10–17 jobs/s over an 8h window; Postgres-queue benchmarks run 10–40k jobs/s — three orders of magnitude of headroom. The real ceilings: DataForSEO 2,000 req/min account-wide (250k worst-case SERPs = ~125 min of pipe; ~40–75 min after cadence tiering), PSI ~1 QPS sustained (5k calls ≈ 83 min), polite crawling 1 req/s/host (parallelizes across 500 distinct hosts). **The nightly window closes with >4× slack** — and when it doesn't, the fix is a second vendor account or cadence tiering, *before* worker infrastructure.

**Scheduler primitives from v1** (~50 lines each): a token bucket per external adapter; a bulkhead per property (one property's crash burns one property's freshness, never the window); **staleness-first dispatch order**, which makes the freshness SLO self-healing after any outage. Weighted priority lanes (new launches 3× for 30 days) only after a real starvation incident.

**Idempotency (v1, not an escalation — retrofitting is unaffordable):** run identity = `(propertyId, snapshotId)`; every step is an upsert keyed by `(snapshotId, entityKey)`; a finalizer marks snapshots complete, so detectors never read half-finished ones; **adapter-call receipts** per `(snapshotId, adapter, requestKey)` prevent re-spending API credits on resume. pg-boss's SKIP-LOCKED "exactly-once" is delivery, not execution — the upsert discipline carries correctness.

**The load-bearing reason the queue stays in Postgres:** transactional enqueue = the outbox pattern for free. "Write Opportunity + enqueue make-job" commits or rolls back atomically; every external broker (SQS/Redis/Kafka) reintroduces the dual-write problem. This guarantee is a named line-item *cost* on any future migration proposal.

**Temporal: three concrete observables, with the counter-precedent attached.** Migrate when (1) multi-week durable timers ship on Actions ("publish, wait 21 days, measure") and the hand-rolled reconciler hits its *second* production bug; (2) human-approval gates must suspend *inside* running pipelines; or (3) deploy-killed runs cost >2–3 eng-hours/week of babysitting. Costs of going: Temporal Cloud $100–500/mo minimums or $400–900/mo self-hosted plus a real determinism/versioning learning curve. Counter-precedent that keeps the trigger honest: **Nango migrated *off* Temporal** onto ~300 lines of Postgres SKIP LOCKED at millions of tasks/month, citing it as their biggest external dependency. If a trigger fires: migrate *only the workflow class that tripped it* (long-lived Actions); batch inspect/compare stays on pg-boss.

**SLOs (SRE-workbook pipeline families), formalized at ~50 properties:** *Freshness* — 95% of active properties have a snapshot ≤26h old, 99% ≤50h pages; *Completeness* — 99% of snapshots reach ≥90% of expected records (pages vs sitemap count, queries vs panel); *Correctness* — golden-fixture property re-run in CI on every detector change. Freshness breaches burn quietly (data is late, not wrong); completeness/correctness breaches poison Opportunities and page immediately. **Error budget is attributed per third-party adapter** (a 95%/30d SLO at 500 properties = 750 stale property-days/mo — absorbs one full vendor-day outage, not two), and **quota headroom is a first-class gauge** (<20% headroom with hours left in the window alerts days before an SLO breach — that's how silent vendor cap regressions get caught).

**Degradation ladder — the invariant: no third-party outage converts into fleet failure, only into *marked staleness*.** Per-adapter circuit breaker → run completes as a partial snapshot with evidence families carried forward under a staleness discount → pg-boss dead-letter queue with redrive, DLQ depth >1h pages a human. Quota exhaustion behaves identically to an open breaker. LLM brownout just holds the make-queue (the human review gate means zero user-facing impact).

**Config blast radius (the CrowdStrike lesson — config changes bypass code pipelines and cause the big outages):** property YAML is schema-validated at PR *and* at load — a failing property is skipped-and-alerted, never thrown inside the scheduler; detector/scoring changes roll out canary-first (3–5 properties, diff the Opportunity output, then fleet); kill-switch per property and per adapter. Canary-diff automation becomes mandatory past ~100 properties, where one bad scoring release wastes 100 properties × human review time on junk.

**Observability:** one `run_metrics` row per (snapshot, stage) and one `adapter_call` receipt per external call — rows, latencies, 429s, quota headroom, and **LLM tokens + dollars per model stage** (the Opus-judge line is the one that surprises). Queryable with the same SQL as domain data; doubles as the SLO source of truth. OpenTelemetry only when a run spans a second service.

## 5. Cost curve, LLM serving, and the operating model

**$/domain/month, with the workload model stated so it's auditable** (per mature domain, monthly: ~100 queries × 2.5 markets sampled weekly, ~520 AI probes, ~100 changed-page extractions, 15 assets through draft+judge):

| | 100 domains | 500 domains |
|---|---|---|
| SERP APIs (DataForSEO $0.60/1k standard queue) | $0.7–8/domain | same rate — no meaningful enterprise cliff until ~2M SERPs/mo |
| AI-answer probes (DIY) | $2.5–8/domain | same |
| LLM pipeline (Batch −50% + caching from v1) | $1–8/domain | $1–12 (more markets) |
| Hosting + Postgres + object storage | <$2/domain ($100–200/mo total) | ≈$0.6–1.4/domain ($300–700/mo total) |
| **Portfolio total** | **≈ $1.2–1.5k/mo** (expected mid-case; component ranges are the bounds) | **≈ $5–10k/mo** (expected mid-case) |

Shape: **linear in domains × markets × queries** with mild concavity from batching/caching. The step functions are *not* infrastructure — they are reviewer headcount, the auto-apply policy decision, and Anthropic rate-tier bumps (cost-neutral). Conclusion a CTO should reach: LLM cost optimization beyond batch+caching is premature at every scale on this roadmap.

**LLM serving:** deterministic routing by stage (Haiku extract → Sonnet draft → Opus judge; escalation: judge-fail → one Sonnet redraft → Opus drafts, expected <5% of assets). **Pin the judge model version per quarter — doc 02 §7's `(tactic, domain_class)` win-rate prior gains a `model_version` dimension the day the judge model changes** — a silent model upgrade otherwise poisons the learn-loop. Cache-key design: three stable→volatile prefix layers (tactic instructions+schema / property context / per-page evidence), deterministic serialization, no timestamps in prompts. **Cost tagging is v1**: every request tagged `(property, tactic, stage, model_version)` with cost rows next to the Evidence store — cost-per-Opportunity is one WHERE clause, and *learn* uses it to kill negative-ROI tactics. Per-property token budgets (new ~2M/mo, mature ~10–15M) with a hard stop at 3× — the failure this catches is a runaway redraft loop turning a $1.50 domain into a $150 one overnight. A standalone gateway (LiteLLM-class) only when spend passes ~$500/mo or a second service consumes the budget.

**Build-vs-buy at scale resolves cleanly:** SERP data is already a commodity *buy*; AI-visibility SaaS **never crosses over** (priced per brand — $99–399/mo × 100 domains = $10k–40k/mo vs ~$250–800 DIY) — instead buy *one* Growth-tier seat as a calibration benchmark and cancel it once DIY probes correlate >0.8 for 3 months; Ahrefs API waits until a backlink detector exists with a pod committed to acting on it.

**The dominant cost line is human review, and it's where the architecture earns its keep.** One consistent chain, checkable line by line: 500 domains × 15 assets/month = 7,500/month ≈ **357 assets/workday**. (a) Without evidence attached, review runs 30–60 min/asset (the reviewer re-verifies every claim) → **22–45 FTEs — naive scaling is simply impossible.** (b) Evidence-attached review with criteria pre-checked runs 5–15 min/asset → **4–11 FTEs** — the review UI is therefore worth on the order of **$200–400k/mo** in avoided headcount, the highest-ROI engineering artifact in the system by a factor of ten. (c) **Graduated auto-apply** then removes the 50–70% of volume that is Tier-0 reversible (title/meta, schema, alt text), leaving 107–179 human-reviewed assets/day → **2–5 reviewers total**. Graduation is gated per `(tactic, property-class)` on ≥50 human-approved applications, ≥95% approval, zero rollbacks in the trailing 30; 5–10% of auto-applied assets stay in the human queue as drift QA; auto-rollback wired to the measure stage. Audit trail is a *view over existing entities* (Action + Snapshot + Measurement), not new infrastructure. Adoption trigger for auto-apply: review demand crossing ~2 FTE (~150–200 domains) or median queue latency >5 business days.

**Operating model — org trigger: a second growth pod exists** (same class as the microservices "no" in §7; until then, process is overhead for a team this size). Then: pods own 20–50 property configs, review queues, and publish decisions; a platform team owns the engine, detectors, scoring, and review UI as the paved road (the Red Ventures / golden-path pattern). Tactics are versioned plugins contributed pod→PR→platform-review. **Win-rate priors stay portfolio-global — cross-domain learning is the entire reason to run one engine instead of 20 SEO tool seats, so per-team forks are the failure mode to design against.** Each property YAML declares a risk tier — a generalisation of doc 02 §5's `publishing_policy` (`review_first` ≡ conservative, `auto_low_risk` ≡ standard; sandbox adds experiment-scale budgets) — setting auto-apply eligibility and monthly asset budget, so the whole risk posture is diffable in git.

## 6. Stage progression — each move has a trigger, not a date

| Stage | Shape | Trigger to advance |
|---|---|---|
| **0 — Slice** (doc 03) | One Next.js app, SQLite, in-process runs | exists to prove the loop |
| **1 — Worker split** | Next.js dashboard + Node worker (same engine package) + Postgres + pg-boss — carrying the v1 obligations from §3/§4: partitioned time-series tables, payload archive, per-adapter token buckets, idempotency keys | first scheduled production runs — topology, not load: the pipeline must survive dashboard deploys |
| **2 — Fleet** | Worker pool scale-out, weighted fair-share lanes, second vendor pipes | nightly window pressure: fleet can't finish inside its window at current concurrency, or one adapter's pipe time exceeds ~50% of the window |
| **3 — Durable workflows** | Temporal (or managed equivalent) for run orchestration; workers unchanged | workflow complexity, not volume: multi-week measurement timers and human-approval gates *inside* runs, cross-deploy resumability, replay-debugging demand |
| **4 — Analytics split** | OLAP store (columnar) fed from Postgres for trend queries; Postgres stays system of record | p95 dashboard trend queries degrade past agreed bounds on partitioned Postgres |

Each stage **adds** a component only when its trigger fires; nothing is rewritten — the engine package, entity schemas, and evidence contracts are constant across all five stages. That invariance is the design's central claim, and it's testable at every stage boundary.

## 7. What we deliberately do NOT build (and the trigger that would change each "no")

- **No microservices.** One engine package, one worker fleet. Trigger to revisit: two teams shipping conflicting engine changes with real coordination cost — an org trigger, not a technical one.
- **No Kafka / event streaming.** Nightly batch cadence with transactional enqueue covers every current flow. Trigger: a genuine real-time consumer (e.g. intraday SERP alerting as a product commitment).
- **No Kubernetes until the fleet is real.** A worker pool on VMs/containers with a queue is operable by one engineer. Trigger: multi-service topology at stage 3+ with deployment coordination pain.
- **No vector DB / embeddings infra.** Content-similarity dedup at current scale runs on pgvector inside Postgres if needed. Trigger: semantic dedup/clustering across millions of pages.
- **No multi-region.** Data is public web evidence; consumers are one team. Latency is irrelevant to a nightly batch. Trigger: none foreseeable — this "no" is probably permanent.
- **No custom crawler infrastructure at Ahrefs scale.** We crawl our *own* ~500 properties politely, not the web. The asymmetry between "portfolio crawler" and "web-scale crawler" is ~6 orders of magnitude and the design never confuses them.

## 8. Why the slice proves this plan *(and not the reverse)*

The scale plan is credible precisely because **stage 0 runs**: the adapter interface, immutable snapshots, typed evidence, deterministic scoring, and config-only onboarding are the same objects at 4 domains and at 500, and the shipped slice exercises every one of them — four properties through one pipeline, an action verified by re-check, and a property onboarded with a config file and no code change. The brief's repeatability test ("the 21st domain is config, not code") is the stage-0 expression of the same invariant this document extends to stage 4. A scale plan without the running slice would be exactly the "one-shot analysis" the brief warns against — and a slice without this plan would be a demo with no future. The submission needs both; this document is the second half.
