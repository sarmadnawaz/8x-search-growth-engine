/**
 * Builds the submission document.
 *
 * Structure follows how a reviewer reads: what it is, whether it meets the
 * brief, what the research found, how it is built, what it produced, what a
 * design review found, and what happens next.
 */
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ShadingType,
  BorderStyle,
  LevelFormat,
  PageBreak,
  PageOrientation,
} = require('docx')
const fs = require('fs')

const INK = '1A1A1A'
const MUTED = '5A5A5A'
const ACCENT = '1F4E79'
const RULE = 'D0D0D0'
const BAND = 'F2F5F8'

const PAGE_WIDTH = 12240 // US Letter, DXA
const MARGIN = 1080
const CONTENT = PAGE_WIDTH - MARGIN * 2

// ---------------------------------------------------------------------------
// building blocks
// ---------------------------------------------------------------------------

const h1 = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 140 },
    children: [new TextRun({ text, bold: true, size: 30, color: ACCENT })],
  })

const h2 = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 260, after: 100 },
    children: [new TextRun({ text, bold: true, size: 24, color: INK })],
  })

const h3 = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 180, after: 70 },
    children: [new TextRun({ text, bold: true, size: 21, color: INK })],
  })

const p = (text, opts = {}) =>
  new Paragraph({
    spacing: { after: opts.after ?? 110 },
    children: [new TextRun({ text, size: 20, color: opts.color ?? INK, italics: opts.italics })],
  })

/** A paragraph with a bold lead-in, so a point can be scanned. */
const point = (lead, rest) =>
  new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 80 },
    children: [
      new TextRun({ text: lead, bold: true, size: 20, color: INK }),
      new TextRun({ text: rest ? ` ${rest}` : '', size: 20, color: INK }),
    ],
  })

const bullet = (text) =>
  new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 70 },
    children: [new TextRun({ text, size: 20, color: INK })],
  })

const mono = (text) =>
  new Paragraph({
    spacing: { after: 60, before: 60 },
    shading: { type: ShadingType.CLEAR, fill: BAND },
    children: [new TextRun({ text, font: 'Consolas', size: 17, color: INK })],
  })

const note = (text) =>
  new Paragraph({
    spacing: { before: 120, after: 160 },
    border: { left: { style: BorderStyle.SINGLE, size: 12, color: ACCENT, space: 10 } },
    children: [new TextRun({ text, size: 19, color: MUTED, italics: true })],
  })

const rule = () =>
  new Paragraph({
    spacing: { before: 120, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 1 } },
    children: [new TextRun({ text: '', size: 2 })],
  })

function table(headers, rows, weights) {
  const widths = weights.map((w) => Math.round((w / weights.reduce((a, b) => a + b, 0)) * CONTENT))

  const cell = (text, { bold = false, fill, width }) =>
    new TableCell({
      width: { size: width, type: WidthType.DXA },
      shading: fill ? { type: ShadingType.CLEAR, fill } : undefined,
      margins: { top: 70, bottom: 70, left: 110, right: 110 },
      children: [
        new Paragraph({
          children: [new TextRun({ text, bold, size: 18, color: bold ? INK : INK })],
        }),
      ],
    })

  return new Table({
    columnWidths: widths,
    width: { size: CONTENT, type: WidthType.DXA },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      left: { style: BorderStyle.NONE },
      right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      insideVertical: { style: BorderStyle.NONE },
    },
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((t, i) => cell(t, { bold: true, fill: BAND, width: widths[i] })),
      }),
      ...rows.map(
        (r) => new TableRow({ children: r.map((t, i) => cell(String(t), { width: widths[i] })) }),
      ),
    ],
  })
}

const spacer = (after = 160) => new Paragraph({ spacing: { after }, children: [] })

// ---------------------------------------------------------------------------
// content
// ---------------------------------------------------------------------------

const body = []

// --- cover -----------------------------------------------------------------
body.push(
  new Paragraph({
    spacing: { before: 1400, after: 60 },
    children: [new TextRun({ text: '8x Search Growth Engine', bold: true, size: 52, color: ACCENT })],
  }),
  new Paragraph({
    spacing: { after: 420 },
    children: [
      new TextRun({
        text: 'A reusable system to find, prioritise, act on and verify search opportunities across every 8x property',
        size: 24,
        color: MUTED,
      }),
    ],
  }),
  rule(),
  p('Build assignment submission · Sarmad Nawaz', { color: MUTED }),
  p('Plan, research, architecture, working slice, and roadmap', { color: MUTED }),
  spacer(320),
  h2('In one paragraph'),
  p(
    'Give the engine a domain and it collects evidence about that domain — technical, keyword, competitor and AI-answer — then turns that evidence into scored opportunities, turns opportunities into actions with machine-checkable acceptance criteria, generates the asset each action calls for, and re-checks whether the work actually got done. Adding the next domain is a configuration file, enforced by a check that fails the build if any engine code mentions a property. It runs today against four real properties, and every number on the dashboard links back to the raw datum that produced it.',
  ),
  note(
    'The one claim this submission refuses to make is the one most systems in this space make freely: that a recommendation is right because a model said so. Every recommendation here carries the evidence that produced it, and every completed action was observed, not asserted.',
  ),
  new Paragraph({ children: [new PageBreak()] }),
)

// --- 1. brief coverage -----------------------------------------------------
body.push(
  h1('1. Does it meet the brief?'),
  p('Point by point against the assignment email.'),
  spacer(80),
  table(
    ['What was asked for', 'Status', 'Evidence'],
    [
      ['Domain in → technical gaps', 'Done', '60 opportunities from crawl evidence'],
      ['→ keyword gaps', 'Done', '256, from live SERP + autocomplete'],
      ['→ competitor gaps', 'Done', '92, from competitor sitemaps (1,385 URLs profiled)'],
      ['→ content gaps', 'Done', 'Snippet and answer-format detectors'],
      ['Prompts / actions to execute', 'Done', 'Every opportunity carries an action + spec'],
      ['A way to verify they got done', 'Done', 'Re-check by observation; status never asserted'],
      ['Generates blogs, tools, landing pages', 'Done', '40 landing pages, 7 blogs, 5 free tools, 3 comparisons'],
      ['Dashboard: evolution over time', 'Done', '4 weekly snapshots; 3 → 7 indexable pages measured'],
      ['Dashboard shows the loop, not static', 'Done', 'Input → evidence → action → output, all clickable'],
      ['Supports any domain we add', 'Done', 'Config-only, enforced by CI across 37 files'],
      ['Evidence behind each recommendation', 'Done', 'No opportunity can exist without evidence IDs'],
      ['A way to tell whether work paid off', 'Done', 'Measurement rows with windows and verdicts'],
      ['Beyond blogs and tools: SEO, GEO, AEO', 'Done', 'AI-visibility probe live and measured'],
    ],
    [42, 14, 44],
  ),
  spacer(),
  note(
    'The email says a one-shot AI analysis is not the assignment. The strongest evidence that this is not one: the engine refuses to claim work is done on domains it cannot deploy to, and it reports "too early" rather than success when a measurement window has not elapsed.',
  ),
  new Paragraph({ children: [new PageBreak()] }),
)

// --- 2. research -----------------------------------------------------------
body.push(
  h1('2. Research'),
  p(
    'Five parallel research passes plus an adversarial critic, with every claim tagged by evidence strength. What follows is what changed the design — not everything that was read.',
  ),

  h2('2.1 Who the portfolio actually is'),
  point('8x is 8x Social', '— an Entrepreneur First company whose portfolio is 13 consumer apps, each on its own domain, shipped between May and August 2026.'),
  point('The domains are weeks old', 'with effectively zero authority, multilingual audiences, and app-store installs as the conversion route.'),
  point('Shortimize is not an 8x property', '— it is a separate company, cited in the brief as a pattern to study rather than a site to copy.'),
  point('Why this changed the build:', 'scoring must favour winnable long-tail and answer-engine citations over head terms a new domain cannot take, and the demo runs on real 8x domains rather than a hypothetical.'),

  h2('2.2 The evidence stack, and what it costs'),
  p('What is usable at zero or near-zero cost, and what a production version buys.'),
  spacer(60),
  table(
    ['Evidence', 'Source used', 'Status'],
    [
      ['Technical', 'Own polite crawler, PageSpeed Insights', 'Real, no cost'],
      ['Demand', 'Google Autocomplete per market', 'Real, tagged "modelled"'],
      ['Rankings, SERP features', 'serper.dev', 'Real, free tier'],
      ['Competitor surfaces', 'Public sitemaps', 'Real, no cost'],
      ['AI-answer visibility', 'Search-grounded LLM probe', 'Real, pennies per run'],
      ['Search volume', 'Modelled from autocomplete', 'Confidence-capped; DataForSEO in production'],
      ['Clicks / impressions', 'Google Search Console', 'Needs site ownership — production only'],
    ],
    [24, 34, 42],
  ),
  spacer(),
  point('Production cost at 21 domains:', 'roughly $30–90/month. At 100 domains, about $12–15 per domain per month.'),
  point('The cost that dominates is human review,', 'not infrastructure — which is why evidence-attached review is the highest-value part of the interface.'),

  h2('2.3 GEO and AEO: what is evidence, what is folklore'),
  p('The brief asks to go beyond blogs and tools. Doing that credibly means separating what is demonstrated from what the industry repeats.'),
  h3('Evidence-backed'),
  bullet('Adding sourced statistics, quotable lines and citations lifts generative-engine visibility 30–40% (Princeton/IIT, KDD 2024 — the only controlled experiment in this area).'),
  bullet('No AI crawler executes JavaScript. A client-rendered page can rank in Google and be entirely invisible to ChatGPT, Claude and Perplexity.'),
  bullet('Answer engines cite differently from each other, so they are separate optimisation targets rather than one "AI search".'),
  h3('Folklore, included because knowing what does not work is also evidence'),
  bullet('llms.txt — Google has said it does not use it; the overwhelming majority of deployed files are never fetched. Shipped as a zero-cost config output, labelled honestly, and claimed for nothing.'),
  bullet('Schema as a direct citation lever — no controlled evidence. Still emitted, because it genuinely matters for Google and Bing surfaces, but its GEO confidence is tagged low.'),

  h2('2.4 Prior art and risk'),
  point('Copied:', 'Ahrefs-style mechanical opportunity detectors, so evidence is attached by construction rather than retrofitted as justification.'),
  point('Copied:', 'crawl-versus-crawl diffing as the definition of done — an issue is fixed when the detector stops firing on a fresh crawl.'),
  point('Avoided:', 'the failure mode every enterprise SEO platform is criticised for — recommendations with no evidence, and no loop from recommendation to outcome.'),
  point('Risk that shaped the design:', "Google's scaled-content enforcement is algorithmic. For a 20-domain portfolio, one shared footprint could demote several properties at once, so publishing is gated by policy and human review rather than being the default."),
  new Paragraph({ children: [new PageBreak()] }),
)

// --- 3. architecture -------------------------------------------------------
body.push(
  h1('3. Architecture'),

  h2('3.1 The loop'),
  mono('config → collect → detect → score → make → verify → measure'),
  spacer(60),
  table(
    ['Stage', 'What it does', 'What it writes'],
    [
      ['Collect', 'Adapters gather evidence from crawl, SERP, autocomplete, competitors, AI answers', 'Evidence rows with source, tier, timestamp'],
      ['Detect', 'Pure functions filter evidence into typed gaps', 'Opportunities referencing evidence IDs'],
      ['Score', 'A deterministic formula in code', 'Stored factors, not just a number'],
      ['Make', 'Generates the asset the opportunity calls for', 'Actions with criteria, plus the artifact'],
      ['Verify', 'Re-fetches and evaluates each criterion', 'Status, and what was observed'],
      ['Measure', 'Compares the evidence series over a window', 'Verdict: improving, flat, declining, too early'],
    ],
    [14, 48, 38],
  ),
  spacer(),

  h2('3.2 Four rules the code enforces'),
  point('Analysis writes evidence, never conclusions.', 'This is why "show me why" is a database join rather than an apology.'),
  point('Snapshots are immutable.', 'Trends, diffs and verification are all comparisons between runs.'),
  point('An adapter failure degrades one evidence family,', 'marks the snapshot partial, and never fails the run.'),
  point('Generating a fix and shipping it are different permissions.', 'No property without deploy access is ever written to, whatever its policy says.'),

  h2('3.3 Scoring: arithmetic, not vibes'),
  mono('score = impact × confidence × fit × tacticPrior ÷ effort'),
  spacer(60),
  point('Impact is defined per opportunity type.', 'A citation gap has no search position to gain, so scoring it with a click-through curve would produce a meaningless number.'),
  point('Achievable position is inferred, not assumed.', 'A weeks-old domain cannot take first place from an established brand, so the target comes from what the SERP actually looks like.'),
  point('Confidence answers one question only:', 'is this datum true. Track record lives in a separate factor, so the same evidence does not silently score differently over time.'),
  point('Displayed priority is a documented mapping.', 'Blockers occupy 90–100; everything else normalises into 20–89 within the snapshot. Every factor is stored, so the arithmetic can be redone by hand.'),

  h2('3.4 Verification: two questions, kept apart'),
  p('Collapsing these would make a fix that shipped perfectly look like a failure for the months rankings take to move.'),
  spacer(60),
  table(
    ['Question', 'How it is settled', 'Can it mark work done?'],
    [
      ['Did it ship?', 'Fetch the page now; nine delivery checks', 'Yes — and only this'],
      ['Did it pay off?', 'Compare the evidence series over a window', 'No — reports a verdict'],
    ],
    [22, 52, 26],
  ),
  spacer(),
  note(
    'A property we cannot deploy to can never honestly reach "verified". Those findings stay proposed with the generated fix attached, and the apply step refuses with a reason. Nothing is displayed as verified that a curl would contradict.',
  ),

  h2('3.5 Why adding domain 21 is configuration'),
  point('Per-property config holds', 'domain, markets, languages, goal, conversion route, competitors, publishing policy, prompt panel.'),
  point('The shared engine holds', 'adapters, detectors, scoring, asset makers, verification and scheduling.'),
  point('A check fails the build', 'if any file under lib/ or app/ mentions a configured domain. The claim is enforced, not asserted.'),
  point('Demonstrated:', 'sway.day was onboarded after the engine was built — one file, zero code changes.'),

  h2('3.6 Stack, and why'),
  spacer(60),
  table(
    ['Layer', 'Choice', 'Deciding reason'],
    [
      ['Runtime', 'Node + TypeScript', 'One type system across engine, model output and UI removes the seam-drift defect class'],
      ['App', 'Next.js (App Router)', 'One process, no separate API to maintain; matches 8x’s own stack'],
      ['Database', 'PostgreSQL + Prisma', 'jsonb for evidence payloads; committed migrations; the stack these properties already run on'],
      ['Containers', 'Docker / Podman compose', 'Migrations run as their own one-shot service so replicas cannot race'],
      ['LLM', 'Two providers behind one seam', 'Grounding is the requirement, not the vendor — an ungrounded probe measures training data'],
      ['Tests', 'Vitest + GitHub Actions', 'Unit, contract, golden detector and full-loop integration against real Postgres'],
    ],
    [16, 26, 58],
  ),
  new Paragraph({ children: [new PageBreak()] }),
)

// --- 4. what it found ------------------------------------------------------
body.push(
  h1('4. What it actually found'),
  p('All of the following is live output, not illustration.'),

  h2('4.1 Portfolio'),
  spacer(60),
  table(
    ['Gap type', 'Opportunities'],
    [
      ['Keyword', '256'],
      ['Competitor', '92'],
      ['Technical', '60'],
      ['AI visibility (GEO/AEO)', '36'],
    ],
    [60, 40],
  ),
  spacer(),

  h2('4.2 The finding worth leading with'),
  p('The AI-visibility probe, run against a real portfolio domain:'),
  mono('"What is the best AI stylist app?"             0 / 3 samples'),
  mono('"How do I plan outfits from my own wardrobe?"  0 / 3 samples'),
  mono('"Best app to organise my closet digitally"     0 / 3 samples'),
  mono('"What is Cherly app?"                          3 / 3 samples'),
  spacer(80),
  point('Read that as:', 'the brand is known when asked by name, and never surfaces for the category questions buyers actually ask.'),
  point('The engine cites competitors instead', '— the same ones already listed in that property’s config. The gap is measured, with the cited URLs stored as evidence.'),

  h2('4.3 A second finding that ties evidence to configuration'),
  mono('No ES content, but MX is a configured market —'),
  mono('competitors publish 106 localised pages.'),
  spacer(80),
  p(
    'This one is only possible because the engine knows what the property is for. A generic SEO tool sees a locale folder; this sees a market the business committed to and has not served.',
  ),

  h2('4.4 The loop closing, end to end'),
  p('On the one property the engine controls, with fixes it generated itself:'),
  spacer(60),
  table(
    ['Date', 'Indexable pages', 'Open opportunities'],
    [
      ['14 Jul', '3', '10'],
      ['21 Jul', '3', '10'],
      ['28 Jul  (after the engine shipped its own pages)', '7', '8'],
      ['4 Aug', '7', '8'],
    ],
    [46, 27, 27],
  ),
  spacer(),
  mono('outcome: indexable pages 3 → 7 over 14d  ⇒  IMPROVING'),
  spacer(60),
  p(
    'Detected a gap, generated a page, shipped it, re-crawled, verified delivery by observation, and measured the outcome. The ranking criterion on the same action correctly still reads "too early" against its window.',
  ),
  new Paragraph({ children: [new PageBreak()] }),
)

// --- 5. production review --------------------------------------------------
body.push(
  h1('5. Production-readiness review'),
  p(
    'A design review of the whole engine, with each finding verified against the running system before it was fixed. Included here because the findings are more useful than a claim of quality.',
  ),

  h2('5.1 The finding that mattered most'),
  point('Measurement was broken on real properties.', 'The response cache had no expiry and short-circuited live fetches whenever a recording existed, so the second run of a property replayed the first run’s data forever.'),
  point('Why that is fatal:', 'every trend the engine reports is a diff between snapshots. With a permanent cache, every verdict would have been "flat" by construction and no property could ever be observed to change.'),
  point('Why the demo still looked right:', 'the local fixture property bypassed the cache. The one property that worked was the only one that could not hit the bug.'),
  point('Fixed by', 'per-adapter freshness windows — crawls in hours, rankings just under a day, demand and probes weekly. Replay still ignores age, because replay reproduces a past run rather than observing the present.'),

  h2('5.2 Measured before and after'),
  spacer(60),
  table(
    ['', 'Before', 'After'],
    [
      ['Dashboard queries (4 properties)', '52', '15'],
      ['Projected at 500 properties', '~6,000 at once against a pool of 9 — throws', 'Flat in property count'],
      ['Property page payload', '2.45 MB', 'Paginated'],
      ['Verification cost', 'Quadratic in calendar time', 'Two row reads'],
    ],
    [34, 36, 30],
  ),
  spacer(),

  h2('5.3 Correctness and trust'),
  point('Blocked requests were being recorded as findings.', 'A rate-limit or WAF block produced "robots.txt missing" at measured confidence — so being blocked manufactured confident recommendations to fix problems that did not exist. Being refused a look is now its own fact.'),
  point('Publication checked one gate of three.', 'Deploy access was enforced; publishing policy and asset review state were not. A review-first property would have shipped drafts the moment it gained access.'),
  point('Action identity was a race.', 'Two concurrent runs could both create the same work, and each duplicate cost a paid generation call. It is a database constraint now.'),
  point('One property failing aborted the rest.', 'Failures are isolated, and the run exits non-zero so a scheduler can tell a broken run from a clean one.'),

  h2('5.4 Security'),
  point('Server-side request forgery.', 'The competitor adapter fetched sitemap URLs taken verbatim from a third party’s robots.txt and archived the responses — a read-anything primitive pointed at whatever that host named. Candidates are now held to the competitor’s own origin, and every request passes a guard that rejects private and link-local addresses on each redirect.'),
  point('Credentials in a build layer.', 'No .dockerignore meant the environment file with live API keys was baked into a cached builder layer.'),
  point('Unescaped structured data.', 'Generated JSON-LD could be closed by model-written copy containing a script tag, on a page we publish.'),
  point('No request had a timeout.', 'One slow host stalled an entire fleet run with nothing else making progress.'),

  h2('5.5 Knowingly deferred'),
  p('Named rather than half-built, because each changes the execution model and belongs with the worker split:'),
  bullet('Batched writes in the collect stage.'),
  bullet('Property-level concurrency with a shared, vendor-keyed rate limiter.'),
  bullet('Reading the adapter-call and run ledgers to produce operational metrics.'),
  bullet('Table partitioning and a retention policy before the evidence tables grow large.'),
  new Paragraph({ children: [new PageBreak()] }),
)

// --- 6. roadmap ------------------------------------------------------------
body.push(
  h1('6. Roadmap'),
  p('Each stage adds a component only when an observable condition makes it necessary. Nothing here is scheduled by date.'),
  spacer(60),
  table(
    ['Stage', 'Shape', 'Trigger to advance'],
    [
      ['0 — Today', 'One app, Postgres, in-process runs', 'Exists to prove the loop'],
      ['1 — Worker split', 'Dashboard + worker sharing the engine package, queue inside Postgres', 'First scheduled production runs — topology, not load'],
      ['2 — Fleet', 'Worker pool, per-adapter rate budgets, partitioned tables, payload archive', 'The nightly window stops closing, or one vendor consumes half the error budget'],
      ['3 — Durable workflows', 'Durable orchestration for long-lived actions', 'Multi-week timers and approval gates inside runs — complexity, not volume'],
      ['4 — Analytics split', 'Columnar store fed from Postgres for trend queries', 'Rollup-backed dashboard queries degrade past agreed bounds'],
    ],
    [18, 40, 42],
  ),
  spacer(),

  h2('6.1 What I would build next, in order'),
  point('1. Feed the detectors that are written but under-fed.', 'Rankings and AI-answer probes both improve immediately with more budget; nothing new needs designing.'),
  point('2. The learn loop.', 'Per-tactic win rates feeding the scoring prior, so a tactic that keeps measuring flat is deprioritised portfolio-wide without anyone editing weights.'),
  point('3. Scheduling and the worker split.', 'Runs move out of the web process; the queue lives inside Postgres, so it adds no new infrastructure.'),
  point('4. First-party outcome data.', 'Search Console access turns the payoff question from sampled rankings into measured clicks, with control-group comparison rather than naive before-and-after.'),
  point('5. The publishing path.', 'Generated assets currently stop at a reviewable artifact. Shipping them as pull requests per property repo is the smallest honest integration.'),

  h2('6.2 What I would want to know from you'),
  bullet('Which properties could grant Search Console access for a test — it changes measurement from sampled to measured.'),
  bullet('How the properties publish, so generated assets can land as pull requests rather than files.'),
  bullet('Whether in-store ASO belongs in this engine, or whether it stops at the web edge with store click-through as the conversion metric.'),
  bullet('Per-property risk appetite: is human review mandatory everywhere, or may reversible technical fixes auto-apply on some properties?'),
  new Paragraph({ children: [new PageBreak()] }),
)

// --- 7. running it ---------------------------------------------------------
body.push(
  h1('7. Running it'),
  mono('cp .env.example .env'),
  mono('compose up -d db          # Postgres 17'),
  mono('npm install'),
  mono('npm run db:migrate'),
  mono('npm run seed              # replays recorded responses through the real pipeline'),
  mono('npm run dev               # dashboard on localhost:3000'),
  spacer(100),
  point('No API keys are needed to look at it.', 'The seed replays recorded responses through the same code path a live run uses, so the demo data cannot drift from what the engine actually produces.'),
  point('To run the pipeline yourself:', 'npm run pipeline -- <domain> [--replay]'),
  point('To check the repeatability claim:', 'npm run check:onboarding'),

  h2('Honest limits'),
  bullet('We cannot execute on domains we do not own. Findings there are detection plus a generated artifact, parked at proposed. The full lifecycle is demonstrated on a property we control.'),
  bullet('Search outcomes lag two to six months. This proves the plumbing — baselines, diffs, verification, windows — not uplift. Verdicts read "too early" until their windows pass.'),
  bullet('Search volume is modelled from autocomplete richness, tagged as such, and confidence-capped in scoring.'),
  bullet('The autocomplete endpoint is undocumented and can rate-limit. Every response is recorded, and a replay mode reproduces a full run offline.'),
  bullet('Seeded history is backdated to show a month of operation. The evidence in every snapshot is real; only the clock is synthetic, and the dashboard says so.'),
  spacer(200),
  rule(),
  p(
    'Repository: github.com/sarmadnawaz/8x-search-growth-engine — 18 pull requests, CI green, 57 tests across unit, contract, golden-detector and full-loop integration layers.',
    { color: MUTED },
  ),
)

// ---------------------------------------------------------------------------

const doc = new Document({
  creator: 'Sarmad Nawaz',
  title: '8x Search Growth Engine',
  description: 'Build assignment submission: plan, research, architecture and roadmap',
  numbering: {
    config: [
      {
        reference: 'bullets',
        levels: [
          {
            level: 0,
            format: LevelFormat.BULLET,
            text: '•',
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 340, hanging: 200 } } },
          },
        ],
      },
    ],
  },
  styles: {
    default: {
      document: { run: { font: 'Calibri', size: 20, color: INK } },
    },
  },
  sections: [
    {
      properties: {
        page: {
          size: { width: PAGE_WIDTH, height: 15840, orientation: PageOrientation.PORTRAIT },
          margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
        },
      },
      children: body,
    },
  ],
})

Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync('8x-Search-Growth-Engine.docx', buffer)
  console.log('wrote 8x-Search-Growth-Engine.docx')
})
