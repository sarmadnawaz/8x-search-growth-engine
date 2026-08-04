# 8x Search Growth Engine — take-home submission

**One paragraph:** A config-driven engine that runs the same loop for every 8x property — *add a domain → inspect → compare → rank opportunities → make → measure → learn* — where every recommendation is a typed detector output carrying its raw evidence (source + fetch time + confidence tier), every action carries machine-checkable acceptance criteria verified by re-crawl, and every outcome is a diff between immutable snapshots. Adding the 21st domain is one YAML file. The design was grounded in 8x's real portfolio: research identified the actual app domains, and live checks (2026-08-04) found cherly.app missing robots.txt and sitemap.xml — the demo's opening finding, shown honestly as *proposed* until it can be executed on a domain we control access to.

**Status:** research, decomposition, system design, build plan, and dashboard mock-up are complete (this repo). The vertical slice build is the next block, hour-boxed against the remaining time in [docs/03-build-plan-24h.md](docs/03-build-plan-24h.md) — nothing below claims code that doesn't exist yet.

## What's here

| Doc | Contents |
|---|---|
| [docs/00-assignment-decomposition.md](docs/00-assignment-decomposition.md) | The brief restated as 10 testable requirements, the implicit rubric, scoping decisions with revisit-conditions, questions for Theo |
| [docs/01-research.md](docs/01-research.md) | Multi-agent research with sources, every claim tiered [strong]/[directional]/[weak]: who 8x is, the $0 evidence stack, GEO/AEO evidence vs folklore, prior art & Google-policy risk, production cost at 21 domains (≈$30–60/mo) |
| [docs/02-system-design.md](docs/02-system-design.md) | Architecture (adapters → evidence → scoring → actions → snapshots), entity model, deterministic scoring formula with a worked example on a real finding, verification & measurement design, 16-tactic SEO/GEO/AEO portfolio, portfolio-level arbitration, ASO scope edge |
| [docs/03-build-plan-24h.md](docs/03-build-plan-24h.md) | Vertical-slice plan boxed to the hours actually remaining, stack decision log with rejected alternatives, runtime de-scope order, honest-limits section |
| [docs/04-process.md](docs/04-process.md) | How this was produced: Claude Code orchestration, model selection rationale, 5-agent parallel research + adversarial critic (which overturned assumptions and live-verified findings), review-panel pass |
| [docs/05-stack-evaluation.md](docs/05-stack-evaluation.md) | Factor-scored stack selection: candidates per layer scored on scalability, reliability, community, hiring, performance, ops cost, type-safety, exit cost — with workload-derived weights and the triggers that would flip each decision |
| [docs/06-scale-architecture.md](docs/06-scale-architecture.md) | The same system at 500 domains: verified load math, storage evolution (partitioned Postgres → OLAP ladder with real precedents), fleet reliability (SLOs, degradation ladder, failure modes), cost curve, human-review throughput math, operating model — every escalation gated on an observable trigger |
| [mockups/dashboard.html](mockups/dashboard.html) | Working dashboard mock-up built around the loop: evidence-linked target list, action detail with acceptance criteria, snapshot diff, trend with shipped-action markers. Open directly in a browser; light/dark aware |

## The three claims this submission stakes out

1. **It's a system, not an audit** — analysis never writes recommendations; it writes evidence. Detectors turn evidence into opportunities; a deterministic formula (not an LLM) turns opportunities into priority; re-crawls turn actions into verified outcomes. Each stage is inspectable.
2. **Repeatability is designed to be demonstrated, not asserted** — the slice runs two real 8x domains through identical code from two config files, adds a third (sway.day) as config-only the first time the pipeline completes, and ships a check that fails if onboarding touches engine code. Until that code lands, this is the plan's acceptance test — stated as such.
3. **Evidence discipline extends to the research and to the demo itself** — every research claim carries a tier; GEO/AEO folklore is included *labelled as folklore* (llms.txt, schema-as-citation-lever); Google's scaled-content enforcement is a first-class design constraint; and findings on domains we can't deploy to are shown as *proposed with a generated fix artifact*, never as fake-verified. The executed→verified lifecycle is demonstrated on a fixture property we control.
