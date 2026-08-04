# 02 — System design

*The design answers one question before all others: how does the 21st domain get added with configuration and review only? Everything else follows from that constraint.*

---

## 1. Shape of the system

```
                        ┌────────────────────────────────────────────────────────┐
 properties/*.yaml ──►  │                    SHARED ENGINE                       │
 (per-property config)  │                                                        │
                        │  Collect        Normalise      Decide        Act       │
                        │  ┌─────────┐    ┌─────────┐   ┌─────────┐  ┌────────┐  │
                        │  │ adapter │───►│ entity  │──►│ scoring │─►│ asset  │  │
                        │  │ registry│    │ store + │   │ + rank  │  │ makers │  │
                        │  └─────────┘    │snapshots│   └─────────┘  └────────┘  │
                        │       ▲         └─────────┘        │           │       │
                        │       │                            ▼           ▼       │
                        │  ┌─────────┐                  ┌─────────┐  ┌────────┐  │
                        │  │ verify  │◄─────────────────│ actions │  │ drafts │  │
                        │  │ (recheck│                  │ + accept│  │ review │  │
                        │  │  pass)  │                  │criteria │  │ queue  │  │
                        │  └─────────┘                  └─────────┘  └────────┘  │
                        └────────────────────────────────────────────────────────┘
                                             │
                                             ▼
                                   Dashboard (per property):
                            baseline · trend · what changed · next action
```

Four principles:

1. **Adapters, not integrations.** Every data source implements one interface: `collect(property_config, snapshot_id) -> Evidence[]`. Whether the datum comes from our crawler, PageSpeed Insights, a SERP API, GSC, or a mocked vendor, downstream code cannot tell the difference. This is what makes paid sources optional and the slice honest — a mocked adapter is labelled in its output, never faked at the data layer.
2. **Everything lands as Evidence before it becomes an opinion.** Analysis never writes recommendations directly; it writes typed evidence rows. A separate rules/scoring stage turns evidence into opportunities. This separation is what makes recommendations auditable ("show me why").
3. **Snapshots are the unit of time.** A pipeline run = one immutable snapshot per property. Trends, "what changed", and outcome verification are all diffs between snapshots. No snapshot, no claim.
4. **Actions carry their own definition of done.** An action is not a to-do string; it is an object with machine-checkable acceptance criteria evaluated by the same collectors that produced the evidence. Verification is a re-run, not a human ticking a box.

## 2. Entity model (the normalised objects the brief asks for)

```
Property      the config unit: domain, markets, languages, goal, conversion route,
              competitors[], content_types[], publishing_policy (review_first | auto_low_risk)
Snapshot      one run of the pipeline for one property (timestamp, engine version)
Page          crawled URL + technical facts (status, canonical, meta, schema, links, speed)
QueryCluster  a topic: representative queries, intent class, market, demand signals
              intent taxonomy: informational | commercial | transactional | navigational | tool_intent,
              plus ai_answer_likelihood (is this query answered by AIO/LLMs today — from SERP evidence)
              Audience comes from Property config (not inferred), per the brief's target-list columns
Evidence      typed datum: {kind, source, value, confidence, snapshot_id, refs}
              kinds: crawl_fact | serp_observation | demand_signal | competitor_fact |
                     ai_answer_probe | backlink_fact | outcome_metric
Opportunity   scored gap: {type, target (page|cluster), evidence_ids[], score, rationale}
              types: technical | content | keyword | competitor | authority | geo_aeo
Action        executable step: {opportunity_id, kind, prompt/spec, acceptance_criteria[],
              status: proposed → approved → executed → verified | failed | stopped}
Asset         generated output: {action_id, type: fix|page|brief|blog|tool_spec|tool,
              body, review_state}
Measurement   outcome series: {target, action_id (nullable), metric, window, baseline, current, verdict}
              attribution rule: when 2+ verified actions share a target within a window, lift is
              credited to the cohort and per-tactic priors update fractionally — or the row is
              flagged unattributable; never silently double-credited
```

The brief's target list — `Domain | Market | Audience | Query/topic | Intent | Evidence | Recommended asset | Priority | Status` — is exactly a join across these entities; it is the dashboard's main table, not a separate store.

## 3. The loop, stage by stage

| Stage | What runs | What it writes |
|---|---|---|
| **Input** | Load/validate `properties/<domain>.yaml` | Property |
| **Inspect** | Own crawler (robots, sitemaps, N pages), technical checks, speed API | Page, Evidence(crawl_fact) |
| **Compare** | Seed queries from config + autocomplete expansion → SERP sampling; competitor sitemap/page diff; AI-answer probes | QueryCluster, Evidence(serp_observation, demand_signal, competitor_fact, ai_answer_probe) |
| **Rank** | Rules + scoring over evidence (see §4) | Opportunity |
| **Make** | LLM asset makers with templates + quality gates (see §5) | Action, Asset |
| **Measure** | Acceptance-criteria re-check; metric deltas vs baseline snapshot | Measurement, Action.status |
| **Learn** | Re-score open bets; stop rules (no movement in N weeks → stopped) | Opportunity.score, Action.status |

## 4. Scoring: how evidence becomes priority

A deterministic, inspectable formula computed **in code from stored evidence** — never an LLM-assigned number (the #1 tell of AI-generated analysis, per the prior-art criticism of enterprise platforms). ICE-family, SEO-native:

```
score = impact × confidence × fit × tactic_prior / effort     (all five stored per opportunity, shown in the UI)

impact      — defined PER OPPORTUNITY TYPE (one table, no free-floating numbers):
  keyword/content   demand(0–10, log-scaled from measured volume or autocomplete richness)
                    × headroom(0–1, CTR-curve delta from current to *achievable* position;
                       achievable derived from authority gap — own OpenPageRank vs top-10 median —
                       plus SERP-weakness signals (UGC/forums in top 10); a zero-authority domain
                       cannot be scored as if #1 were reachable)
                    × market_weight (config)
                    × AIO discount (~0.5 if an AI Overview absorbs clicks on this query —
                       applies ONLY to organic-CTR types, never to geo_aeo)
  geo_aeo           demand × citation-share headroom (1 − current inclusion rate in sampled answers)
  technical hygiene coverage of affected pages × severity class
                    (rendering/discovery/hygiene — e.g. missing sitemap = discovery, weight 2–3)
  authority         gap size × count of opportunities blocked on authority
confidence  = evidence_tier × agreement × sampling_discount
              tier: measured 1.0 · modeled 0.6 · fixture 0.3   (tier of the *weakest* load-bearing datum)
              agreement: 1 + 0.25 × (independent sources − 1), capped at 1.5
              sampling_discount: for probe-kind evidence, Wilson lower bound of the inclusion rate
              (an n=5 LLM probe is NOT as certain as a deterministic HTTP 404)
fit         = per-property config weights by intent/asset type (0.5–1.5); off-topic → 0 (refused)
tactic_prior= portfolio learn-loop factor (see §7); starts at 1.0, Beta-shrunk — n=1 barely moves it
effort      = asset class: technical fix 1 · page edit 2 · new page 3 · data page 5 · free tool 8
```

**True blockers bypass the demand math** and occupy a reserved priority band. Blocker means *actually gates indexation*: `noindex` on money pages, `robots.txt Disallow: /`, robots.txt returning 5xx (Google then defers crawling), canonical loops, or the whole site invisible to non-JS crawlers. **A 404 robots.txt is not a blocker — Google treats it as allow-all** — and a missing sitemap on a 24-page site merely slows discovery. Those are *discovery-hygiene* fixes: cheap, high-certainty, still often the right first action (effort 1), but they must not impersonate emergencies.

**Score → displayed priority (0–100):** true blockers occupy **90–100** (90 + 10 × coverage); everything else is min-max normalized onto **20–89 within a property-snapshot**. Every dashboard priority is reproducible: raw factors are stored per row and the mapping is one function.

**Worked example (real finding, live-checked 2026-08-04):** cherly.app returns 404 for both robots.txt and sitemap.xml — two `crawl_fact` evidence rows, source `crawler`, tier `measured` (1.0), agreement 1.0, sampling 1.0. Type: technical hygiene (discovery class, severity 2.5, coverage 1.0) → raw = 2.5 × 1.0 × 1.0 (fit) × 1.0 (prior) / 1 (effort) = **2.5**. Keyword comparison from the same property: "ai stylist app" — autocomplete shows 14 suggestion variants (`modeled` demand 6/10), Serper shows no cherly.app result in top 20 and two UGC results in the top 10 (`measured`; achievable position ≈ 6–10 for a zero-authority domain → headroom 0.6), market 1.0, no AIO on this query (×1.0), confidence 0.6 × 1.25 = 0.75, fit 1.3, prior 1.0, effort 3 (new page) → raw = 6 × 0.6 × 1.0 × 0.75 × 1.3 × 1.0 / 3 = **1.17**. With this snapshot's non-blocker raw range [0.5, 2.5], min-max onto 20–89 gives the hygiene fix **89** and the keyword play **43** — and the arithmetic above is checkable line by line, which is the point.

Sub-scores are deduplicated to **template level** (one "34 pages missing canonical" opportunity, not 34 rows) and weighted by affected-page value, per the health-score-as-vanity-metric critique.

## 5. Make: generation with guardrails

- Every asset maker is template + LLM + **quality gate**: schema-valid output, citations resolve to evidence rows, banned-claims lint, minimum-substance checks (a data page must contain data, not prose about data).
- **Publishing policy is config**: `review_first` (default) routes every asset to a human review queue; `auto_low_risk` may auto-apply only reversible technical fixes (e.g. meta descriptions), never new indexable pages.
- Rationale: Google's scaled-content-abuse enforcement makes ungated programmatic publishing an existential risk for a 20-domain portfolio — one demoted property is a bad week; a shared footprint pattern demoting several is a catastrophe. The engine therefore treats "can generate" and "may publish" as different permissions. *(Risk detail in doc 01.)*

## 6. Verify and measure: the two questions kept separate

1. **Did it get done?** — acceptance criteria on the Action, evaluated by collectors (the Semrush compare-crawls pattern: "fixed" = the detector no longer fires on a fresh snapshot): page resolves 200 and is indexable; canonical present; schema extracts; internal links exist. Binary, fast, runs next snapshot.
2. **Did it pay off?** — Measurement rows over subsequent snapshots, with **stated windows** (technical fixes: 2–4 weeks; content: 8–12 weeks — rankings realistically move over 2–6 months) and honest verdicts: `improving | flat | declining | too_early`. Slice metric: a **visibility index** per property, defined precisely so it can't be gamed: a *frozen* query panel from config (changing the panel starts a new index series), each query's contribution = CTR-curve weight of the current position × demand estimate. Not comparable across properties (different panels) — the portfolio view labels it per-property trend, not a leaderboard. Production metric: GSC clicks/impressions with CausalImpact-style counterfactuals against control page-groups (SearchPilot's pattern: split pages, not users; report credible intervals) — never naive before/after. Stop-rules turn "flat past the window" into freed capacity.

**Cold-start baseline (most 8x domains are weeks old):** CrUX will 404, GSC has nothing, rankings are empty. Day-0 health therefore comes from signals that always exist: robots/sitemap presence · indexed-page count (`site:` sample + Bing coverage) · lab CWV from PSI · schema presence · brand-SERP ownership (does the domain rank #1 for its own name?) · OpenPageRank score · knowledge-graph entity presence (KG Search API) · LLM brand-answer accuracy ("what is Cherly?" probe). Every one of these is measurable on day 0 and diffable on day 30 — the trend chart is never empty.

## 7. Learn: outcomes feed back into scoring

The loop closes only if measurement changes future decisions. Mechanism: a per-tactic **win-rate table** — `(tactic, domain_class) → verified actions, measured lifts, flat/declined` — updated as verdicts land, feeding the **`tactic_prior` factor** in §4. (At production scale the key gains a `model_version` dimension the day LLM-judged stages change models, so a silent upgrade can't poison priors — doc 06 §5.) Deliberately *not* folded into `confidence`: confidence answers "is this datum true", the prior answers "does this tactic pay off here" — conflating them would make the same evidence score differently over time and break auditability, so the UI shows them as separate factors. The prior is Beta-shrunk (initialised Beta(3,3) ≈ 1.0): one verified win nudges it, it takes a run of outcomes to move a portfolio-wide prior materially. A tactic that keeps measuring flat gets deprioritised without anyone editing weights; stopped bets stay stored with their evidence — the system remembers *why* something didn't work.

## 8. Dashboard = the loop made visible

Mock-up: [`mockups/dashboard.html`](../mockups/dashboard.html). The design rule: **every number is a link that ends at raw evidence.** Portfolio view (all properties, sparkline trends) → property view (loop status for the latest run, health baseline + trend with shipped-action markers, "what changed since last snapshot") → target list (evidence chips with source + confidence on every row) → action detail (acceptance criteria checklist + generated asset + measurement verdict). Nothing on the dashboard is a static score; everything is a state of the loop.

## 9. The repeatability test, answered concretely

Adding domain #21 means: write `properties/newdomain.yaml` (≈12 lines: domain, markets, languages, goal, conversion route, competitors, content types, publishing policy, prompt panel) → engine schedules it into the same pipeline → first snapshot becomes its baseline. No new code paths — the Airbyte declarative-connector-manifest pattern, applied to properties instead of APIs. The slice will prove it by running **cherly.app and pocketpal.me through the identical engine from two config files**, then adding **sway.day as the "next domain"** with a config file and zero code diff — run the first time the pipeline completes end-to-end, not saved for the final hour. A CI-style check fails if onboarding a property touches `lib/engine/`.

## 10. Data adapters (slice vs production)

Full vendor/pricing detail in research doc 01 §2. Adapter registry as shipped in the slice:

| Adapter | Slice mode | Production mode |
|---|---|---|
| `crawler` | real — polite fetcher, ~30 pages/domain | same, scaled + scheduled |
| `psi` / `crux` | real (free APIs; CrUX 404s recorded as "below popularity threshold") | same |
| `autocomplete` | real (per-market `hl`/`gl` from config; gray endpoint, labelled) | DataForSEO keyword endpoints |
| `serp` | real — Serper free credits (rank, SERP features); queries/domain is a config knob the cost model keys on | DataForSEO at $0.0006/query |
| `aio` | real — SerpAPI free tier (documents the `ai_overview` block); "AIO not served to this client" recorded as an explicit evidence state | DataForSEO AIO endpoints |
| `authority` | real — OpenPageRank + competitor sitemap diff | + Moz API (cheapest real link data) |
| `ai_probe` | real — prompt panel vs **search-grounded** endpoints (slice: Perplexity, retrieval-native with citations); inclusion *rate* over samples with Wilson-bound confidence; brand matched as brand + category/domain (bare strings collide: Luma, Sway — `entity_collision` flag per property) | + OpenAI Responses `web_search`, Gemini with Search grounding, scheduled; or Otterly/Profound |
| `kg_search` | real — Google Knowledge Graph Search API (free key): entity presence per brand | same |
| `bing_coverage` | **gray in slice** — `site:` sample scrape, labelled | Bing Webmaster API + IndexNow once ownership granted |
| `volume` | **mocked** — modeled from autocomplete richness, confidence-capped | DataForSEO ($0.05/1k keywords) |
| `gsc` | **mocked** — realistic fixtures behind the real interface | the outcome source (needs site ownership) |
| `store_click` | **production-only** — needs first-party instrumentation (same access question as GSC); slice proxy: store-link + Smart App Banner presence checks, which are public | web→store conversion event |

Portfolio-scale cost at 21 domains: **≈ $30–60/month** (breakdown in doc 01 §2).

## 11. Tactic portfolio — beyond keyword blogs and free tools

Every tactic is an opportunity *type* with a machine-detectable trigger and a verification metric — that's what makes them systematisable across 20+ properties. Evidence tiers per research doc 01 §3.

| Tactic | Trigger (evidence) | Verification | Tier |
|---|---|---|---|
| GEO retrofit blocks (answer-first TL;DR + sourced stats + quotable lines) | Page ranks top-20; AI answer exists for the query; domain absent from its citations | Citation-inclusion rate delta, treated vs untreated cohort | strong (Princeton KDD 2024) |
| Original-data statistics pages from 8x product data | Third-party stat pages own the citations for target queries; first-party data exists | AIO/LLM citation appearance; referring domains | strong/directional |
| Comparison, alternatives, "best X" surfaces | Competitors co-occur with category in sampled AI answers; brand absent; no fresh owned page | Brand inclusion rate in prompt panel pre/post | directional (Ahrefs 26k-URL study) |
| Freshness pipeline (real content deltas, never date-bumping) | Owned cited/ranking page with last substantive update > 90–180 d | Citation-retention rate, refreshed vs stale cohort | directional |
| Earned-listicle outreach queue | Same third-party URL cited ≥N times for money prompts, brand absent | Recommendation-rate lift after placement | directional |
| Entity / knowledge-graph establishment (Wikidata, `sameAs`, consistent brand corpus) | No KG entity; "what is <brand>?" probe returns wrong/empty | KG Search API presence; branded-answer accuracy | directional |
| PAA-mined FAQ blocks | ≥N unanswered/competitor-owned PAA questions in a ranked cluster | PAA ownership tracking per question | strong mechanism |
| Featured-snippet capture | Snippet exists, we rank 2–10, competitor owns it | Snippet-ownership flip via scheduled SERP pulls | strong mechanism |
| AI-crawlability baseline (no-JS parity, bot policy, Bing/IndexNow) | Parity diff fails; robots blocks search bots; Bing coverage gap | Re-check passes; AI-bot fetches in logs | strong (Vercel/MERJ) |
| "Speakable" brand-answer pages (own the facts about your own products) | Prompt panel shows factual errors or competitor citations for branded prompts | Branded-answer error rate → 0; own-domain citation share | logic + directional |
| Free tools, AEO-upgraded (SSR'd value, HowTo/SoftwareApplication schema) | Tool-intent modifier queries where AI answers recommend competitor tools | Tool recommendation rate in panel; AI-referral sessions | directional |
| Programmatic glossaries / definitional hubs | Definitional PAA/AIO citations go to competitor glossaries | Snippet/AIO ownership per term; indexation rate | directional + abuse-gated |
| Safe cross-domain pattern — disclosed parent-brand entity linking, shared `parentOrganization` schema; **never** anchor-text link meshes | New domain cold-start (all of 8x's launches) | Indexation velocity; referring-domain diversity stays majority-external | strong (risk side) |
| Distribution via 8x's own creator network (mention/link routing to flagship assets) | Authority gap blocks an otherwise-high-impact cluster | Mention volume, assisted citations in AI answers | 8x-unique |
| Multi-surface: YouTube transcripts / podcast co-occurrence | AIO cites videos for target queries; ours absent | Video citation sampling in AIO references | directional |
| llms.txt + markdown mirrors (config-generated freebie) | Developer-audience property; agent fetches observed in logs | Fetch counts by agent UAs (default off otherwise) | folklore, honestly labelled |

## 12. Scope edges: ASO and the install funnel

8x's real conversion is the **app-store install**, not the pageview. In scope for the engine's design: web→store measurement — outbound store-click tracking as the conversion event (**production-only**: it requires first-party instrumentation on the properties, the same access question as GSC — doc 00 Q1/Q3). Slice-level proxy from public data: store-link and Smart App Banner / deep-link presence as inspect checks. Out of scope, named as production roadmap: in-store ASO (store keyword data via AppTweak/Sensor Tower as future adapters — same Evidence interface). The engine's edge is the web; it must *measure through* to the store door.

## 13. Portfolio-level arbitration (the problem single-domain tools don't have)

Three 8x finance apps can chase the same "budgeting app" cluster and cannibalise each other. The engine maintains a **cross-property cluster registry**: when a query cluster scores for 2+ properties, allocation is decided on **evidence-derived comparables** — existing rank/citation footprint in the cluster, topical corpus overlap with the cluster — with config `fit` only as tiebreak (fit alone would mean "whoever typed the bigger YAML number wins"). If the SERP evidence shows multiple winnable slots (weak top-10, distinct intents), **dual pursuit is allowed** — two owned results on one SERP is real estate, not always cannibalisation. Losing siblings get status `blocked_by_portfolio` with a pointer to the winner — visible, reversible, auditable; exact ties go to the property with the older claim, flagged for human review. Conflicting evidence between adapters (autocomplete shows demand, volume source says zero) resolves by tier: `measured` beats `modeled`; disagreement within a tier caps confidence and flags the row for review rather than silently averaging.
