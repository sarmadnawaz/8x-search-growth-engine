# Search Growth Engine

A reusable engine that finds, prioritises, acts on and **verifies** search growth opportunities across a portfolio of domains. Add a domain → inspect → compare → rank → make → measure → learn, with the same code path for every property.

The design constraint everything else follows from: **adding the next domain is a config file, not a code change** — and there's a check that fails if that stops being true.

---

## Run it

```bash
npm install
cp .env.example .env
npm run dev            # dashboard on http://localhost:3000, seeded with real data
```

No API keys needed to browse: the SQLite database is committed with four properties already run.

To run the pipeline yourself:

```bash
npm run pipeline -- cherly.app --replay     # offline, replays recorded API responses (0.1s)
npm run pipeline -- cherly.app              # live (keys optional; missing ones degrade cleanly)
npm run check:onboarding                    # the repeatability test
```

## What actually works

| | |
|---|---|
| **Real evidence** | Polite crawler, Google Autocomplete, PageSpeed Insights, SERP sampling. Every row carries source, confidence tier and fetch time |
| **Mechanical detectors** | Filters over evidence, so a recommendation cannot exist without the data that produced it |
| **Deterministic scoring** | `impact × confidence × fit × prior ÷ effort`, computed in code — no LLM assigns a priority |
| **Actions with acceptance criteria** | Machine-checkable, re-evaluated against a fresh fetch |
| **Verification by observation** | An action reaches `verified` only when a re-check passes |
| **Config-only onboarding** | Enforced by `npm run check:onboarding` |
| **Offline replay** | Full pipeline from cached fixtures, no keys |

### Verified end to end

On `demo-fixture.local`, a site the engine controls (served over real HTTP during the run):

```
run 1            6 actions, 2 assets — robots+sitemap 0/2 criteria pass
run 2 --apply    shipped robots.txt, sitemap.xml
                 [verified] Publish robots.txt — 2/2 criteria pass
                 [verified] Publish an XML sitemap — 2/2 criteria pass
run 3            0 new actions, still verified (idempotent)
```

On **cherly.app**, a real portfolio domain, the engine independently found what the research predicted — no robots.txt, no sitemap.xml, no canonical or structured data on any of 6 crawled pages — and produced the fix. Because we have no deploy access there, those actions stay **`proposed` with the artifact attached**, and `--apply` refuses:

```
apply:  refused Publish robots.txt for cherly.app — no deploy access for cherly.app
```

That refusal is the point. Nothing in this system is displayed as verified when a `curl` would say otherwise.

### Repeatability, demonstrated

| property | pages | clusters | evidence | opportunities |
|---|---|---|---|---|
| cherly.app | 6 | 32 | 22 | 4 |
| pocketpal.me | 8 | 18 | 29 | 3 |
| sway.day | 6 | 12 | 23 | 3 |
| demo-fixture.local | 3 | — | 10 | 6 |

`sway.day` was onboarded after the engine was built: one YAML file, zero code changes.

## How it's put together

```
properties/*.yaml     per-property config — the only property-specific surface
lib/engine/
  adapters/           collect evidence (crawler, autocomplete, serp, psi) + fixture cache
  detectors/          pure functions: evidence -> scored opportunity drafts
  scoring.ts          the formula, with the score -> priority mapping documented
  make.ts             actions + generated artifacts; generating and shipping are separate permissions
  verify.ts           re-check acceptance criteria against a fresh fetch
  pipeline.ts         orchestration, degradation handling, snapshots
lib/schemas.ts        Zod: one source of truth for entity shapes
app/                  dashboard (Next.js + shadcn/ui)
scripts/              pipeline CLI, onboarding check
```

Four rules the code enforces:

1. **Analysis writes evidence, never conclusions.** Detectors turn evidence into opportunities; scoring turns opportunities into priorities. Each stage is separately inspectable.
2. **Snapshots are immutable.** Trends, diffs and verification are all comparisons between runs.
3. **Adapter failure degrades one evidence family**, marks the snapshot `partial`, and never fails the run.
4. **Generating a fix and shipping it are different permissions.** No property without `deployAccess` is ever written to, whatever its policy says.

## Honest limits

- **We can't execute on domains we don't own.** Findings there are detection plus a generated artifact at `proposed`. The executed → verified lifecycle is demonstrated on a property we control.
- **SEO outcomes lag 2–6 months.** This proves the plumbing — baselines, diffs, verification, windows — not uplift. The trend chart shows indexable pages, which moves on a timescale that can be shown honestly; ranking outcomes belong to the measure stage's windows.
- **Search volume is `modeled`** from autocomplete richness, tagged as such, and confidence-capped in scoring. Production swaps in a volume API behind the same adapter and the tier becomes `measured`.
- **The autocomplete endpoint is undocumented** and can rate-limit. That's why every response is cached and `--replay` exists.
- **SERP evidence needs a key.** Without `SERPER_API_KEY` the keyword detectors return nothing and the snapshot is marked degraded — the engine does not invent rankings to fill the gap.

## What I'd do next

1. **Feed the SERP and AI-visibility detectors** — both are written, typechecked and tested, but under-fed: SERP sampling needs a `SERPER_API_KEY` (free tier), and the AI probe needs an OpenAI account with active billing (the key on hand returns `429 — account is not active`). Neither invents data in the meantime; the evidence family is simply absent and the snapshot is marked degraded.
2. **LLM asset makers behind the existing seam** — `lib/engine/llm.ts` already exposes schema-constrained generation; drafts would be validated by the Zod schemas in place and gated by the review queue that already exists. Model tiering (cheap for extraction, mid for drafting, top for evaluation) is a routing policy inside a provider, not a different shape of call.
3. **Measurement windows** — the `Measurement` entity and verdict vocabulary (`improving / flat / declining / too_early`) are modelled; the scheduled re-measure job is not yet written.
4. **The learn loop** — per-tactic win-rate priors feeding the `tacticPrior` factor, which currently defaults to 1.0.

## Documents

| Doc | |
|---|---|
| [00 decomposition](docs/00-assignment-decomposition.md) | The brief as testable requirements, scoping decisions, open questions |
| [01 research](docs/01-research.md) | Evidence stack, GEO/AEO evidence vs folklore, prior art, policy risk — every claim tiered |
| [02 system design](docs/02-system-design.md) | Architecture, entity model, scoring, verification, 16-tactic portfolio |
| [03 build plan](docs/03-build-plan-24h.md) | Hour-boxed slice, decision log, de-scope order |
| [04 process](docs/04-process.md) | How this was researched and built, including what review passes caught |
| [05 stack evaluation](docs/05-stack-evaluation.md) | Factor-scored per layer, with the triggers that would flip each decision |
| [06 scale architecture](docs/06-scale-architecture.md) | The same system at 500 domains, every escalation gated on an observable trigger |
