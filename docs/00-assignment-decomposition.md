# 00 — Assignment decomposition

*Source material: Theo's email (2026-08-03) + the 6-page product brief PDF ("8x Search Growth Engine"). This document restates the ask as testable requirements, extracts what is actually being evaluated, and records every scoping decision I made — with rationale — so nothing in the build is an unexamined default.*

---

## 1. The ask, restated as requirements

| # | Requirement | Source | Testable form |
|---|---|---|---|
| R1 | **Domain in → opportunities out.** Given a domain, identify gaps across technical, content, keyword, and competitor dimensions | Email ¶3, Brief p.3 | Adding a domain produces a populated, prioritised target list with zero manual research steps |
| R2 | **Evidence behind every recommendation.** Each opportunity carries its source data and a confidence level | Email ¶5, Brief p.3 | Every target-list row links to the raw signal that produced it (crawl result, SERP snapshot, keyword datum) |
| R3 | **Actions with verification.** The system produces prompts/actions to execute against gaps *and a way to verify they actually got done* | Email ¶3 | Every action has machine-checkable acceptance criteria; a re-check pass flips status only when criteria pass |
| R4 | **Self-generated outputs.** Some outputs are produced by the system itself: blogs, free tools, landing pages, fixes | Email ¶3, Brief p.4 | At least one generated asset of ≥2 types exists in the slice, each traceable to the opportunity that justified it |
| R5 | **Dashboard showing evolution over time.** Per-domain health baseline + trend; answers "what changed, what next, is it paying off" | Email ¶3–4, Brief p.2 | Dashboard renders ≥2 snapshots per domain and diffs them |
| R6 | **The dashboard shows the loop, not a report.** Domain input → evidence → prioritised action → useful output, visibly connected | Email ¶4 | You can click from a domain to an opportunity to its evidence to its generated asset to its verification status |
| R7 | **Repeatability across 20+ domains.** Adding the 21st platform = configuration + review, not new code | Email ¶4, Brief p.5 | The slice demonstrates ≥2 domains running through the identical pipeline, differing only in a config file |
| R8 | **Beyond blogs and free tools.** Propose additional SEO, GEO, and AEO tactics | Email ¶6 | The plan names a tactic portfolio with trigger-evidence and verification per tactic (see doc 02) |
| R9 | **Anti-requirement.** A one-shot AI analysis of a single website is explicitly *not* the assignment | Email ¶5 | Everything above is schema-driven and re-runnable; no free-text "audit report" as the core artifact |
| R10 | **Deliver within 24h:** plan, research, mock-ups, anything started building. Clear thinking > polish | Email ¶7 | This repo: docs 00–04, mockup, and the slice per its status in §5 — nothing claimed that doesn't exist |

## 2. What is actually being evaluated (reading between the lines)

The email says it directly — "we care more about clear thinking and a useful working direction than polish" — and the brief's structure confirms it. My read of the rubric:

1. **Systems thinking over feature count.** The brief dedicates a full page to *config-per-property vs shared engine*. The repeatability test (p.5) is the single most explicit acceptance criterion anywhere in the material. This is the hill to die on.
2. **Evidence discipline.** "Important recommendations should carry a source and confidence level" (p.3). An LLM that asserts "you should target keyword X" without a datum behind it fails the brief even if the output looks impressive. The data model must make evidence a first-class object, not a text field.
3. **Closed loop, not open pipeline.** Inspect → … → measure → *learn*. Most candidates will build the left half (analysis). The differentiator is the right half: verification and outcome measurement.
4. **Judgment about scope.** 24 hours cannot produce the production system. They want to see *which* slice I chose and *why* — the cut-lines are part of the deliverable.
5. **Process fluency with AI tooling.** The candidate brief for me personally: show how the research, planning, and build were run (Claude Code, model selection, agent fan-out) as a repeatable engineering process — documented in doc 04.
6. **The evaluator is the CTO.** Research established that Theo Bui is 8x's co-founder/CTO (ex-ML engineer at Cleo), and 8x is an Entrepreneur First company shipping ~3 apps a month. Expect an evaluation taste for speed, leverage, and honest engineering trade-offs over enterprise ceremony — and expect the "is this a system or a one-shot audit" probe to be applied hard.

## 3. Scoping decisions (defaults I chose, and why)

Decisions made without waiting for answers — each is reversible and flagged in the submission as an assumption.

| # | Decision | Rationale | Revisit if |
|---|---|---|---|
| D1 | **Public-data-only evidence.** No Google Search Console / analytics access assumed | I don't own the 8x domains; the brief says "public and approved data" (p.2). GSC becomes a documented production adapter, not a slice dependency | Theo grants GSC access to a test property |
| D2 | **Demo domains: real 8x properties — `cherly.app` + `pocketpal.me`, with `sway.day` as the live "add the next domain" config test.** *(Revised after research: recon identified 8x's actual portfolio of 13 apps on individual domains; Shortimize turned out to be a separate company cited only as a pattern.)* | Running the engine on the reviewer's own weeks-old domains — where live checks already confirmed real findings (cherly.app is missing robots.txt and sitemap.xml as of 2026-08-04) — beats any hypothetical demo | 8x supplies the canonical domain list |
| D3 | **Real data where free, adapter-mocked where paid — labelled per datum.** Crawler, PageSpeed Insights, autocomplete, free-tier SERP data: real. Paid volume/backlink data: behind the same adapter interface, marked `source: mocked` | Honesty beats fake completeness; the adapter seam itself demonstrates the architecture | Trial credits for a data vendor materialise |
| D4 | **Generated assets land as reviewable drafts, never auto-published.** Publishing policy is a per-property config field | Brief p.2 "safe publishing rules"; Google's scaled-content-abuse policy makes ungated auto-publishing the biggest professional red flag in this space | 8x states an appetite for auto-publish on low-risk asset types |
| D5 | **Snapshot-based time series.** Every pipeline run persists an immutable snapshot; trends are diffs between snapshots — even if the slice only holds 2–3 snapshots | Cheapest mechanism that makes the dashboard genuinely "evolve over time" (R5) rather than being decorated with fake history | — |
| D6 | **One runnable app, zero-infra.** Reviewer must run it with one command; no Docker orchestration, no managed DB | R10: they will spend minutes, not hours, running it | — |

*(Stack choice and data-vendor specifics are deliberately deferred to doc 01/03 — they are research outputs, not assumptions.)*

## 4. Questions for Theo — asked in the submission, not blocking the build

1. Do any 8x properties have Search Console / GA4 access you'd grant a test key for? (Changes the measurement adapter from SERP-sampling to first-party data.)
2. Research confirmed 13 registrable domains (canonical table in doc 01 §1: 11 app domains + 8x.social + 8x-internal.com; Dede's domain unconfirmed). What are the remaining properties toward "20+", with markets/languages per domain?
3. Publishing path: the properties look like Next.js apps on Vercel — should "make" outputs land as MDX pull requests per repo, a shared content service, or draft artifacts for now?
4. Is ASO (app-store keyword optimization) in scope for this engine, or does it stop at the web edge (store-click-through as the conversion metric)?
5. Per-property risk appetite: is human review mandatory everywhere, or may low-risk technical fixes (meta descriptions, robots/sitemap) auto-apply on some properties?
6. Any existing data subscriptions (Ahrefs/Semrush/DataForSEO) whose API keys the engine should reuse?

## 5. Deliverable map for the 24h

| Deliverable | Where | Status | Gate |
|---|---|---|---|
| Research with sources | `docs/01-research.md` | ✅ done | Multi-agent sweep, findings verified against sources |
| System design + tactic portfolio | `docs/02-system-design.md` | ✅ done | Passes the repeatability test on paper |
| Build plan for remaining hours | `docs/03-build-plan-24h.md` | ✅ done | Boxed to real remaining time; runtime de-scope order stated |
| Process narrative (how this was built) | `docs/04-process.md` | ✅ done | Honest log: models, agents, decisions — including what review passes caught |
| Dashboard mock-up | `mockups/dashboard.html` | ✅ done | Shows the loop, not a score page; no fake-verified states |
| Working vertical slice | `lib/engine/`, `app/` | ✅ done | Four properties through one pipeline; fixture property closes the verify loop; `npm run dev` on a seeded DB |
