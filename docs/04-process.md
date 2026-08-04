# 04 — Process: how this was researched, planned, and built

*This document is part of the deliverable on purpose. The assignment asks for a system that turns evidence into prioritised action with verification — so the way I produced the submission follows the same discipline: decompose → gather evidence in parallel → challenge it adversarially → decide with rationale → build against acceptance criteria. Everything below is the actual log, not a reconstruction.*

---

## 1. Tooling and model selection

All orchestration ran in **Claude Code** with **Claude Fable 5** (`claude-fable-5`) as the driving model. Selection logic, which also carries into the product's own pipeline:

| Task class | Model | Why |
|---|---|---|
| Orchestration, synthesis, architecture decisions, writing | Fable 5 (top tier) | Highest-judgment work; the expensive model is justified where a wrong call cascades |
| Parallel research agents | Session model, inherited | Research quality gates everything downstream; not the place to save tokens |
| *Product pipeline (planned):* per-page extraction & intent classification | Haiku 4.5 ($1/$5 per MTok) | High-volume, schema-constrained, low-judgment — measured by structured-output validity, not prose quality |
| *Product pipeline:* briefs, drafts, comparison pages | Sonnet 5 ($2/$10 intro) | Quality/cost sweet spot for templated generation behind QA gates |
| *Product pipeline:* opportunity rationale, evaluator in draft→critique→revise | Opus 5 ($5/$25) | The judgment stages; evaluator-optimizer per Anthropic's "Building Effective Agents" |

The same principle in both places: **spend model quality where judgment concentrates; spend volume where schemas constrain the output.**

## 2. Step 1 — Decompose before researching (~30 min)

Read the email + 6-page brief PDF and rewrote them as **10 testable requirements** (R1–R10), an explicit read of the evaluation rubric, and **6 scoping decisions** with revisit-conditions (doc 00). Key call made here: the brief's repeatability test ("the 21st domain is config + review, not code") is the single most explicit acceptance criterion in the material, so the architecture question was fixed *before* any research: config-per-property vs shared engine, decided at minute 30, held all the way through.

## 3. Step 2 — Parallel research fan-out with an adversarial critic (~10 min wall-clock)

Instead of researching serially, I launched **five parallel Claude Code research agents**, each with one lens and explicit instructions to distinguish confirmed facts from inference:

1. **Company recon** — who is 8x really, what are the actual domains?
2. **Data sources** — every evidence API with 2026 pricing/limits, and a USE / MOCK / PRODUCTION-ONLY verdict per source under a $0, 24h constraint
3. **GEO/AEO state of the art** — with orders to separate evidence from SEO-industry folklore
4. **Prior art & risk** — how Ahrefs/Semrush/BrightEdge/AirOps model this; where they fail; Google policy risk
5. **Build practice** — agentic content pipelines, current Claude pricing/APIs, take-home presentation research

Then a **sixth agent ran as completeness critic** over the combined output: what's missing, which claims are dubious, top risks of the submission failing. Totals: ~1.05M tokens, 122 tool calls, ~10 minutes wall-clock.

This structure paid off concretely:

- Recon **overturned a planning assumption**: Shortimize isn't an 8x property (separate Lisbon company — reference pattern only), while 8x's real portfolio is 13 consumer apps on individual domains, launched at ~3/month. Demo domains switched from shortimize.com to cherly.app + pocketpal.me before any code existed.
- The critic **live-verified claims against real domains** and found that cherly.app, ingatikrecall.com, and falia.app are missing robots.txt *and* sitemap.xml (checked 2026-08-04) — turning the demo's first finding into a real one.
- The critic caught **7 material gaps** (no ASO/install-funnel story, no concrete scoring formula, no cold-start baseline for zero-authority domains, no learn mechanism, no portfolio-cannibalization rule, thin multilingual coverage, unlabelled gray-area dependencies) — each now addressed in doc 02 — and flagged ~10 stats as vendor-snapshot claims to hedge or drop, which is why every research claim carries an evidence tier.

## 4. Step 3 — Synthesis with evidence tiers

Research became doc 01 with each claim tagged **[strong] / [directional] / [weak]** — the same source-and-confidence discipline the brief demands of the engine's recommendations. Folklore is included *labelled as folklore* (llms.txt, schema-as-GEO-lever): knowing what *doesn't* work is part of the evidence.

## 5. Step 4 — Design, mock-up, and this plan

Doc 02 (architecture: adapters → evidence → scoring → actions with acceptance criteria → snapshots), doc 03 (build plan boxed to remaining hours, with decision log and explicit cut-lines), and an HTML mock-up of the dashboard built around the loop rather than a score page — rendered and visually verified in both themes.

## 6. Step 5 — Adversarial review before submission (and what it caught)

Before finalising, the full document set went through a **panel of four independent review agents** (hiring-manager/CTO lens · staff-engineer systems lens · skeptical-SEO-practitioner lens · 24h-realism lens), each instructed to attack, not summarise. Being specific about what it caught matters more than claiming the pass happened:

- **The flagship demo action was impossible as drafted** — the plan had the verified-action moment running on cherly.app, a domain we can't deploy to; the mock-up even showed it "verified" while the live site still 404s. Fixed: the executed→verified lifecycle moved to a fixture property we control; cherly.app's finding is shown at `proposed` with the generated fix as an artifact.
- **A domain-knowledge error** — the design treated a 404 robots.txt as an indexability blocker; Google treats it as allow-all. Reclassified to discovery hygiene, and the blocker class redefined to actual blockers.
- **The time budget was double-booked** — the build plan boxed a fresh 24h inside a window that research and docs had already partly consumed. Rebased to the real remaining hours with a runtime de-scope order.
- **Arithmetic and normalization gaps in the scoring example**, present-tense claims about not-yet-built code, count inconsistencies in the recon, and an ungrounded-LLM-probe design flaw (models can't cite domains newer than their training data without search grounding) — all fixed in place.

A review pass that changes the submission this much is the strongest argument for running it. The build phase (next) follows the same pattern Anthropic documents for Claude Code — explore → plan → code with verification checks at each stage, CLAUDE.md checked in (it is, at the repo root), incremental commits per working block, subagent review of diffs against the plan.

## 7. Why this process is the point

The assignment warns against "a one-shot AI analysis." The process above is the opposite shape: parallel evidence gathering with sources, an adversarial pass that changed conclusions (Shortimize, ASO, scoring), decisions logged with rejected alternatives, and machine-checkable acceptance criteria before implementation. It is also — deliberately — the same loop the Search Growth Engine itself runs: **inspect → compare → rank → make → measure → learn.** A process that wouldn't survive its own product's standards would be a bad sign.
