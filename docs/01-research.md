# 01 — Research

*Method: five parallel research agents (company recon · evidence data sources · GEO/AEO state of the art · prior art & risks · build/agentic practice) run in Claude Code, followed by a completeness-critic pass that challenged the combined findings and live-verified key claims against 8x's own domains on 2026-08-04. Every claim below is tagged by evidence tier — **[strong]** (primary/controlled/verified live), **[directional]** (large-N but vendor/correlational), **[weak]** (single-source or self-reported). Full source list at the end of each section.*

---

## 1. Who 8x actually is — and what that changes about the assignment

**[strong]** 8x is **8x Social** (8x.social): an SF-based, Entrepreneur First-backed company founded 2026 by Jaka Bavdek (CEO) and Theo Bui (CTO — the author of this assignment). Core business: a managed creator network ("120k+ creators. Organic reach. No ad spend."). Growth figures — $1.4M ARR in 5 months, $3M+ run rate — are the founders' own claims **[weak]**.

**[strong]** The "20+ domains" are real and enumerable from app-store developer records (iOS developer id 1894971455; Google Play developer "8x"). Canonical table — the single count every other document quotes:

| App | Domain | Launched | Store |
|---|---|---|---|
| 8x Creators | 8x.social | 2026-05-06 | iOS + Android |
| PocketPal Budget | pocketpal.me | 2026-05-30 | iOS + Android |
| Luma: Talk it Out | heyluma.app | 2026-06-12 | iOS + Android |
| Sway: Relax and Stretch | sway.day | 2026-07-17 | iOS |
| Steadi: Freelancer Budget | steadiapp.co | 2026-07-22 | iOS + Android |
| Ingatik: Recall | ingatikrecall.com | 2026-07-22 | iOS |
| Laut: PDF Text to Speech | getlaut.app | 2026-07-24 | iOS |
| Cherly: AI Personal Stylist | cherly.app | 2026-07-27 | iOS |
| Brawnix | brawnix.fitness | 2026-07-28 | iOS |
| Ledgexa: Invoice & Get Paid | ledgxa.com | 2026-07-29 | iOS |
| Alaria | alaria.app | 2026-08-03 — **the day before this assignment** | iOS |
| Falia | falia.app | — | Android only |
| Dede | *(domain unconfirmed)* | — | Android only |

**13 distinct apps; 13 confirmed registrable domains** (11 app domains + 8x.social + 8x-internal.com, their internal portal). The gap to "20+" is presumably unreleased or web-only properties — the brief's figure is the company's own.

**[strong]** Shortimize is **not** an 8x property — it's a separate Lisbon company whose /tools page (~45 utilities) the brief cites as a *pattern*. The brief's PDF already enumerates all 45 tools.

**What this changes:**
- The demo domains should be **real 8x properties**, not Shortimize. Live checks (2026-08-04) found **cherly.app, ingatikrecall.com and falia.app all return 404 for both robots.txt and sitemap.xml** — a genuine, verifiable technical finding the slice can open with.
- These are **weeks-old domains with near-zero authority**, multilingual audiences (8x.social ships 18 locales; stated priority markets: Turkey, Brazil, Mexico, Germany, Spain), and a conversion route of **app-store installs** currently driven by creator content. Scoring must favour low-difficulty long-tail, tools, and answer-engine citations over head terms a zero-authority domain can't win — and the measurement loop ultimately has to reach *installs*, not sessions.
- Launch cadence (several apps/month) is *why* config-only onboarding is the acceptance test.
- 8x's public engineering footprint (marketing site on Next.js/Vercel; engineering job postings) means a TypeScript/Next.js slice will read as native to their stack.
- One asset no competitor has: distribution recommendations can route into their **own 120k-creator network**.

Sources: 8x.social · theobui.com · jakabavdek.com · iTunes lookup id 1894971455 · Google Play developer "8x" · shortimize.com/about.

## 2. Evidence data stack — what's real for $0 in 24 hours

Verdicts: **USE** (real data in the slice) / **MOCK** (same adapter interface, fixture data, labelled) / **PROD** (documented production path only).

| Evidence | Source | Cost & limits (2026) | Verdict |
|---|---|---|---|
| Technical crawl | Own polite fetcher (robots, sitemaps, ~30 pages/domain; status, canonicals, meta, headings, hreflang, internal links, JSON-LD extraction) | $0, no auth | **USE** |
| Lab performance | PageSpeed Insights API | Free API key; generous quota (verify per-project in GCP console) | **USE** |
| Field CWV + trend | CrUX API + History API (40 weeks of weekly data) | Free, 150 QPM hard cap; young 8x domains will 404 → record as "below CrUX popularity threshold" | **USE** |
| Demand signal | Google Autocomplete (`suggestqueries.google.com`, `hl`/`gl` per market) | Free, unauthenticated, undocumented/gray — production replacement: DataForSEO | **USE** |
| Search volume | DataForSEO (~$0.05/1k keywords, $1 trial) · Keyword Planner (needs Ads account) | No honest free API in 2026 → slice models volume from autocomplete richness, labelled `modeled` | **MOCK** |
| SERP / rank / SERP features | Serper.dev (2,500 free credits, no card — verified live) for rank + features | Slice math: 3 domains × 30 queries × top-10 ≈ 90 credits/run; queries/domain is a config knob the cost model keys on | **USE** |
| AI Overview presence + citations | SerpAPI (250/mo free, documents the `ai_overview` block) · DataForSEO ($0.0006/query + AIO flag) in production | AIOs are not reliably served to all scraping clients — "AIO not served to this client" is recorded as an explicit evidence state, never conflated with "not cited" | **USE** (SerpAPI) |
| Authority proxy | OpenPageRank (30k domains/mo free) · competitor **sitemap diffing** (free) | Real backlink APIs are PROD: Moz ~$49/mo cheapest, Majestic ~$400/mo, Ahrefs enterprise four-figures/mo | **USE** |
| AI-answer presence | DIY LLM probe — **search-grounded endpoints only**: Perplexity API (retrieval-native, returns citations), OpenAI Responses API with the `web_search` tool, Gemini with Google Search grounding. Every 8x domain post-dates model training cutoffs, so an *ungrounded* call can never cite them — ungrounded probes are useful only for the brand-fact-accuracy check. Matching is brand + category/domain (bare brand strings collide: Luma, Sway) | Pennies per run; slice uses Perplexity only; SaaS equivalents (Profound ~$499+/mo, Peec ~€90+, Otterly API from $189/mo) are PROD | **USE** |
| Clicks/impressions/queries | Google Search Console API | Free but requires verified ownership; 16-mo retention, ~3-day lag, 50k rows/day | **MOCK** (the production outcome source) |
| Trends | Official Google Trends API still gated alpha (announced Jul 2025); pytrends archived Apr 2025 | Nice-to-have | **MOCK** |

**Slice stack** = own crawler + PSI + Autocomplete + Serper + SerpAPI (AIO) + Perplexity probe, with CrUX/OpenPageRank as documented adapters: every evidence row carries `source` and a confidence tier (`measured` / `modeled` / `fixture`). Near-$0 (probe calls cost pennies); five signups done in parallel at hour 0: GCP, Serper, SerpAPI, Perplexity, Anthropic.

**Production cost at 21 domains** (the "what does this cost" question): daily SERP tracking 21×30 queries ≈ $12–19/mo (DataForSEO/Serper) · monthly volume refresh ≈ $1–2 · PSI/CrUX/GSC free · weekly AI-probe panels ≈ $2–8 · LLM pipeline on changed pages via Batch API (50% off) ≈ $10–30. **≈ $30–60/month total** — the engine is data-cheap; the cost centre is human review time.

## 3. GEO / AEO — what's evidence-backed in 2026 vs folklore

**The demand side [strong-to-directional]:** AI Overviews appear on ~16% of queries broadly, up to ~48% in commercial verticals (tracker-dependent); when present, position-1 CTR drops by roughly half (Pew clickstream; Ahrefs). All AI assistants combined still drive ~1% of site traffic, but AI referrals convert far better than organic **[weak, single Similarweb-derived study]** — so GEO/AEO is a *quality-and-optionality* channel, not a traffic replacement. Honest framing matters here.

**Per-engine behaviour differs [directional]:** ChatGPT over-cites Wikipedia and fresh "best X" listicles (43.8% of cited page types in Ahrefs' 26k-URL study); Google AIO favours brand domains and YouTube; Perplexity favours Reddit/UGC and <30-day freshness; AI Mode citations overlap AIO only ~14%. These are separate optimisation targets → the engine tracks `aio_cited` / `chatgpt_cited` / `perplexity_cited` per query cluster.

**The only controlled experiment [strong]:** Princeton "GEO" paper (KDD 2024, 10k queries): adding **sourced statistics, quotable expert lines, and citations** lifts generative-engine visibility 30–40% (up to +115% for mid-ranked pages); keyword stuffing performs at/below baseline. This is the evidence basis for a templatable "GEO retrofit" asset.

**Crawler layer [strong]:** No AI crawler executes JavaScript (Vercel/MERJ, 500M+ GPTBot fetches) — a client-rendered page can rank in Google yet be invisible to ChatGPT/Claude/Perplexity. Every provider splits training bots (GPTBot, ClaudeBot, Google-Extended) from search bots (OAI-SearchBot, Claude-SearchBot, PerplexityBot). Bing indexation still partially gates ChatGPT search visibility → Bing coverage + IndexNow are cheap config-level fixes. Per-domain `ai_crawler_policy` belongs in property config.

**Folklore, stated as such [strong negative evidence]:** **llms.txt** — Google explicitly doesn't use it, ~97% of deployed files are never fetched by AI bots, zero measured citation effect (worth shipping only as a zero-cost template output, honestly labelled). **Schema as an LLM-citation lever** — LLMs tokenize JSON-LD as plain text; schema still matters for Google/Bing surfaces, so emit it, but tag its GEO confidence low. **Fake date-bumping** and **owned-domain link meshes** — refuted/dangerous.

**Tactic portfolio** (the "beyond blogs and free tools" ask) — 18 tactics were researched; doc 02 §11 systematises 16 as opportunity types (the other two became engine machinery rather than tactics: the always-on AI-visibility measurement harness is the `ai_probe` adapter, and Reddit/UGC participation folded into the distribution row as a policy-gated, human-executed play). Headliners: GEO retrofit blocks; original-data statistics pages from portfolio product data ("citation magnets" — a moat unique to an app operator); fresh comparison/alternatives surfaces; freshness pipeline with real content deltas; earned-listicle outreach mined from citation data; entity/Wikidata establishment with programmatic "what is <brand>" probes; PAA-mined FAQ blocks; AI-crawlability baseline; featured-snippet capture; "speakable" brand-answer pages; safe cross-domain pattern (disclosed parent-brand entity linking — **never** a link mesh).

## 4. Prior art — what to copy, what to avoid

**Copy: Ahrefs' Opportunities report [strong]** — 12 opportunity types, each a *mechanical filter* over already-collected data ("ranking 4–15", "404s with backlinks", "competitor top-10 keywords you lack", "snippet exists, you rank 2–8, don't own it"). Evidence is attached *by construction*. The slice implements 5–6 such detectors as pure functions.

**Copy: crawl-vs-crawl diffing (Semrush) [strong]** — issues flip Fixed/New between dated snapshots; "done" = the detector no longer fires on a fresh crawl. This is the industry's definition-of-done mechanism and is cheap to build.

**Copy: AirOps' governed content pipeline [strong]** — brand kits as per-property config, RAG grounding, and human review checkpoints (an approval inbox) before anything publishes.

**Copy: Airbyte's declarative YAML connector manifest [strong]** — the canonical precedent for "the 21st integration is a config file, not code."

**Avoid: the enterprise-platform failure modes [directional but consistent]** — BrightEdge/Conductor criticism is uniform: cookie-cutter recommendations without evidence, scoreboards without playbooks, no outcome loop, and auto-publish features that break sites. Health scores are vanity metrics unless issues are weighted by page value and deduplicated to template level.

**Outcome measurement [strong]:** "Did it pay off" has real prior art — CausalImpact-style Bayesian counterfactuals on GSC clicks with control page-groups (SearchPilot's production pattern: split pages, not users; report credible intervals). Honest time lags: indexing days-to-weeks; ranking movement 2–6 months; only ~5.7% of new pages reach top-10 within a year (Ahrefs, 2M-page study) — lower still for low-authority domains like 8x's. **The 24h demo must show baseline-snapshot plumbing, not fake instant uplift.**

**Risk rails [strong]:** Google's scaled-content-abuse enforcement went algorithmic (Aug 2025 spam update targets programmatic near-duplicate sets); site-reputation abuse enforcement now *decouples* off-topic sections from domain authority. Google's stated position: quality "however it is produced" — the penalty is for thin sameness, not automation. Consequences for the engine: per-page unique-value gates, per-domain publishing-rate caps, topical-scope enforcement from config, human review by default. One shared footprint across 20 domains is the tail risk that could demote several properties at once — guardrails are a feature, not compliance theater.

## 5. Build-layer facts used in the plan

- **Claude pricing (verified against current catalog):** Opus 5 $5/$25 per MTok · Sonnet 5 $3/$15 (intro $2/$10 through 2026-08-31) · Haiku 4.5 $1/$5 · Batch API −50% · structured outputs via `messages.parse` (Zod/Pydantic schemas). Stage mapping: Haiku for per-page extraction/classification, Sonnet for briefs/drafts, Opus for the ranking/strategy pass and the evaluator in draft→critique→revise loops (Anthropic's evaluator-optimizer pattern). A full demo run over ~30 pages ≈ well under $1.
- **Stack (decision log in doc 03; factor matrices in doc 05):** one Next.js (App Router) + TypeScript app, SQLite via Prisma (Postgres as the production target behind the same schema), Zod schemas shared engine↔UI, Recharts for trends, jobs-as-SQLite-table for infra-free pipeline runs. One `npm install && npm run dev` for the reviewer; seeded DB so the dashboard works with no API keys.
- **2026 hiring reality [directional]:** reviewers explicitly evaluate *how* candidates drove AI tools — commit history, checked-in CLAUDE.md/SPEC.md, decision logs with rejected alternatives, and explicit cut-lines are the differentiators (doc 04).

## 6. Gaps the critic pass surfaced (now addressed in the design)

1. **ASO / install funnel was missing** — 8x's real conversion is app-store installs; the design now includes web→store measurement and names full ASO as scoped-out with a production path (doc 02 §12).
2. **No concrete scoring formula** → doc 02 §4 now specifies weights, evidence-tier multipliers, and a worked example on a real finding.
3. **Cold-start baseline for zero-authority domains** (CrUX 404s, no GSC, no rankings) → day-0 metric set defined in doc 02 §6.
4. **"Learn" had no mechanism** → per-tactic win-rate priors feeding confidence, doc 02 §7.
5. **Portfolio cannibalization** (three finance apps chasing one query cluster) → cross-property arbitration rule, doc 02 §13 — a genuinely novel requirement no single-domain tool handles.
6. **Multilingual thinness** → market-driven keyword universes (`hl`/`gl` per config market), hreflang checks in inspect; noted that all cited GEO studies are US/EN-only.
7. **Gray-area dependencies** must be labelled (autocomplete endpoint is undocumented; polite-crawler policy stated; production replacement named per dependency).

Key sources: help.ahrefs.com (Opportunities) · searchpilot.com (SEO testing math) · semrush.com/kb (compare crawls) · Princeton GEO, KDD 2024 · developers.openai.com/api/docs/bots · Vercel/MERJ AI-crawler study · developers.google.com (spam policies, AI content, site-reputation abuse) · dataforseo.com pricing · developer.chrome.com/docs/crux · anthropic.com/engineering/building-effective-agents · code.claude.com/docs/best-practices · docs.airbyte.com (declarative manifests) · docs.airops.com.
