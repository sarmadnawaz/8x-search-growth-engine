# Search Growth Engine

One system that finds, prioritises and verifies search work across a portfolio of domains.

You give it a domain. It gathers evidence about that domain, turns the evidence into a ranked list of gaps, writes the asset each gap calls for, and then fetches the page again to confirm the work actually happened. Adding the next domain is a config file, and there is a check in CI that fails the build if that stops being true.

```
collect  ->  detect  ->  score  ->  make  ->  verify  ->  measure
```

## Run it

Needs Node 22 and a container runtime. Compose works with Docker or Podman.

```bash
cp .env.example .env
compose up -d db          # Postgres 17
npm install
npm run db:migrate
npm run seed              # replays recorded API responses through the real pipeline
npm run dev               # dashboard on localhost:3000
```

No API keys are needed to look at it. The seed runs the same code path a live run uses, replaying recorded responses, so the demo data cannot drift from what the engine actually produces.

Everything containerised, closest to production:

```bash
compose --profile app up
```

Then:

```bash
npm run pipeline -- cherly.app --replay   # offline, from recorded responses
npm run pipeline -- cherly.app            # live, keys optional
npm test                                  # unit, contract, golden, integration
npm run check:onboarding                  # the repeatability check
```

## What it does

| Stage | What happens | What it writes |
|---|---|---|
| Collect | Adapters gather from crawl, search results, competitor sitemaps, AI answers | Evidence, each row with its source and confidence tier |
| Detect | Pure functions filter evidence into typed gaps | Opportunities pointing at the evidence behind them |
| Score | A formula in code, no model involved | Every factor stored, not just the result |
| Make | Writes the asset the gap calls for | Action with acceptance criteria, plus the artifact |
| Verify | Fetches the page again and checks | Status, and what it actually observed |
| Measure | Compares the evidence series over a window | Improving, flat, declining, or too early |

Each run writes a new snapshot and nothing is edited in place, so trends and diffs are comparisons rather than a separate history table.

## Four rules the code enforces

**Analysis writes evidence, never conclusions.** A recommendation cannot exist unless the rows justifying it exist first. The schema refuses to build one with an empty evidence list, so "show me why" is a join rather than an apology.

**Snapshots are immutable.** Every question worth asking here is a comparison. What changed, did the fix hold, is the trend real.

**An adapter failing degrades one evidence family and never fails the run.** A failed adapter marks the snapshot partial and records what is missing. Missing evidence is recorded as missing rather than treated as a finding.

**Generating a fix and shipping it are separate permissions.** A property without deploy access is never written to, whatever its publishing policy says.

## Scoring

```
score = impact x confidence x fit x tacticPrior / effort
```

No model assigns a priority. A generated score cannot be recomputed or argued with, so the formula lives in code, every input is stored on the row, and the dashboard prints the arithmetic next to the result.

Three parts needed thought:

- **Impact is defined per gap type.** A citation gap has no ranking position to gain, so scoring it with a click through curve would give a number that looks meaningful and is not.
- **Achievable position is inferred, not assumed.** A three week old domain will not take first place from an established brand. If the top ten is full of forum posts the target is position three; if it is established brands, eight.
- **Confidence answers one question only,** which is whether the datum is true. How well a tactic tends to work is a separate factor.

## Verification

Two questions, kept apart, because they answer on different clocks.

| Question | How it is settled | Can it mark work done |
|---|---|---|
| Did it ship | Fetch the page now, run the delivery checks | Yes, and only this |
| Did it pay off | Compare the evidence series over a window | No, it reports a verdict |

Checks record what they saw, not just pass or fail. A failing criterion reads `canonical_missing still present` or `40 chars of initial-HTML text`, so anyone can reproduce it with curl.

Actions on properties without deploy access stay at `proposed` with the generated fix attached, and the apply step declines with a reason.

## Adding a property

```yaml
domain: example.app
name: "Example"
goal: app_installs
conversionRoute: app_store_link
markets:
  - { market: us, language: en }
competitors: [rival.com]
seedQueries: [example widget]
publishingPolicy: review_first
deployAccess: false
```

That is the whole cost of onboarding. `npm run check:onboarding` scans every file under `lib/` and `app/` and fails if any of them mentions a configured domain.

## Layout

```
properties/*.yaml     per property config, the only property specific surface
lib/engine/
  adapters/           collect evidence, plus the recorded response cache
  detectors/          pure functions turning evidence into gaps
  makers/             landing pages, blogs, free tools, comparison pages
  scoring.ts          the formula and the priority mapping
  checks.ts           the acceptance check vocabulary
  verify.ts           re-check by observation, and the measure stage
  http.ts             one place with timeouts, SSRF guard and size caps
lib/schemas.ts        Zod, the single source of truth for entity shapes
app/                  dashboard
scripts/              pipeline CLI, onboarding check
tests/                unit, contract, golden detector, integration
```

## Tests

```bash
npm test
```

Four layers. Unit tests on the scoring logic. Contract tests that catch vendor response drift before it corrupts evidence. Golden tests that pin detector output, because detectors change meaning silently. One integration test that runs the whole loop against real Postgres and asserts that an action reaches verified only after the fix exists and a re-check observes it.

CI runs typecheck, the onboarding check, all tests against a Postgres service, and the build, on every pull request.

## Honest limits

- I cannot deploy to domains I do not own, so findings there stop at a generated artifact. The full lifecycle is demonstrated on a property I control.
- Search outcomes take two to six months. This proves the plumbing, not the payoff. Verdicts read `too_early` until their windows pass.
- Search volume is modelled from autocomplete richness, tagged as modelled, and capped in scoring so it cannot outrank measured data.
- The autocomplete endpoint is undocumented and can rate limit. Every response is recorded, and replay mode reproduces a full run offline.
- Seeded history is backdated to show what a month of running looks like. The evidence in each snapshot is real, only the clock is synthetic, and the dashboard says so.

## Design notes

`docs/` holds the working notes: how the assignment was read, the research and its sources, the system design, the stack evaluation and the scale architecture.
