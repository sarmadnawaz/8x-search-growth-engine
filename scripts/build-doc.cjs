/**
 * Builds the submission document.
 *
 * Focus: how I understood the problem, how I reasoned to a solution, what I
 * researched, what I designed, and what I would do next. Not a feature tour.
 *
 * House style follows the 8x brief: numbered section eyebrows, one headline
 * per page, short blocks, a blue line to close each section.
 * Prose rules: first person, plain words, no em dashes, short.
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

const INK = '434343'
const MUTED = '767676'
const BLUE = '1155CC'
const RULE = 'DDDDDD'
const BAND = 'F5F7FA'

const PAGE_WIDTH = 12240
const MARGIN = 1260
const CONTENT = PAGE_WIDTH - MARGIN * 2

const eyebrow = (text) =>
  new Paragraph({
    spacing: { before: 420, after: 220 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 8 } },
    children: [
      new TextRun({ text: text.toUpperCase(), bold: true, size: 17, color: BLUE, characterSpacing: 30 }),
    ],
  })

const headline = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 140, after: 280 },
    children: [new TextRun({ text, bold: true, size: 42, color: INK })],
  })

const label = (text) =>
  new Paragraph({
    spacing: { before: 260, after: 80 },
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text, bold: true, size: 25, color: INK })],
  })

const p = (text) =>
  new Paragraph({
    spacing: { after: 140, line: 300 },
    children: [new TextRun({ text, size: 22, color: INK })],
  })

const bullet = (text) =>
  new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 100, line: 290 },
    children: [new TextRun({ text, size: 22, color: INK })],
  })

/** Bullet with a bold lead so a point can be read at a glance. */
const point = (lead, rest) =>
  new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 110, line: 290 },
    children: [
      new TextRun({ text: lead, bold: true, size: 22, color: INK }),
      new TextRun({ text: rest ? ` ${rest}` : '', size: 22, color: INK }),
    ],
  })

const mono = (text) =>
  new Paragraph({
    spacing: { after: 50, before: 50 },
    shading: { type: ShadingType.CLEAR, fill: BAND },
    children: [new TextRun({ text, font: 'Roboto Mono', size: 19, color: INK })],
  })

const callout = (text) =>
  new Paragraph({
    spacing: { before: 340, after: 200, line: 300 },
    children: [new TextRun({ text, bold: true, size: 23, color: BLUE })],
  })

function table(headers, rows, weights) {
  const widths = weights.map((w) => Math.round((w / weights.reduce((a, b) => a + b, 0)) * CONTENT))

  const cell = (text, { bold = false, fill, width }) =>
    new TableCell({
      width: { size: width, type: WidthType.DXA },
      shading: fill ? { type: ShadingType.CLEAR, fill } : undefined,
      margins: { top: 90, bottom: 90, left: 120, right: 120 },
      children: [
        new Paragraph({
          spacing: { line: 280 },
          children: [new TextRun({ text, bold, size: 20, color: INK })],
        }),
      ],
    })

  return new Table({
    columnWidths: widths,
    width: { size: CONTENT, type: WidthType.DXA },
    borders: {
      top: { style: BorderStyle.NONE },
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

const gap = (after = 200) => new Paragraph({ spacing: { after }, children: [] })
const pageBreak = () => new Paragraph({ children: [new PageBreak()] })

const body = []

// ---------------------------------------------------------------------------
// Cover
// ---------------------------------------------------------------------------
body.push(
  new Paragraph({
    spacing: { before: 2600, after: 140 },
    children: [
      new TextRun({ text: '8X / BUILD ASSIGNMENT', bold: true, size: 17, color: BLUE, characterSpacing: 30 }),
    ],
  }),
  new Paragraph({
    spacing: { after: 200 },
    children: [new TextRun({ text: '8x Search Growth Engine', bold: true, size: 64, color: INK })],
  }),
  new Paragraph({
    spacing: { after: 700 },
    children: [
      new TextRun({
        text: 'How I read the problem, what I found, what I built, and what comes next.',
        size: 25,
        color: MUTED,
      }),
    ],
  }),
  new Paragraph({ children: [new TextRun({ text: 'Sarmad Nawaz', size: 22, color: MUTED })] }),
  pageBreak(),
)

// ---------------------------------------------------------------------------
// 01 The problem
// ---------------------------------------------------------------------------
body.push(
  eyebrow('01 / The problem'),
  headline('You are not short of SEO tools. You are short of a repeatable process.'),

  p('Reading the brief, the thing being asked for is not an audit. It is a process that runs the same way on every property, so a new domain does not start a new research project.'),

  label('What that means in practice'),
  point('The unit of work is the portfolio, not the site.', 'Anything that only works because someone knows a particular domain does not scale to twenty.'),
  point('A recommendation without evidence is an opinion.', 'If nobody can see why, nobody can trust it or argue with it.'),
  point('Shipping is not the finish line.', 'The question is whether the work paid off, which needs a before, an after, and a window.'),
  point('You launch about three apps a month.', 'So config only onboarding is not an architectural nicety. It is the actual cadence.'),

  label('What would make this fail'),
  bullet('A one shot analysis dressed up as a system.'),
  bullet('A model assigning priority scores nobody can recompute.'),
  bullet('Claiming work is done without checking.'),

  callout('So I set one test for myself: every number on screen must trace back to a datum, and nothing is marked done unless something observed it.'),
  pageBreak(),
)

// ---------------------------------------------------------------------------
// 02 Research
// ---------------------------------------------------------------------------
body.push(
  eyebrow('02 / Research'),
  headline('Three assumptions I had to throw away.'),

  point('Shortimize is not yours.', 'It is a separate company in Lisbon. The brief points at the pattern, not the site. So I built against your real domains instead of a stand in.'),
  point('The portfolio is weeks old.', '13 apps shipped between May and August, each on its own domain, with effectively no authority. Scoring cannot assume a page can reach first place.'),
  point('The conversion is an install.', 'Not a signup. Measurement has to reach the store link rather than stopping at a pageview.'),

  callout('Every finding in this document is from a live 8x domain, not a hypothetical.'),

  pageBreak(),
  eyebrow('02 / Research'),
  headline('What data is free, and what is not.'),

  table(
    ['Evidence', 'Source', 'Cost'],
    [
      ['Technical health', 'My crawler, PageSpeed Insights', 'Free'],
      ['Demand', 'Google Autocomplete, per market', 'Free, modelled not measured'],
      ['Rankings, SERP features', 'serper.dev', 'Free tier'],
      ['Competitor surfaces', 'Their public sitemaps', 'Free'],
      ['AI visibility', 'Search grounded LLM probe', 'Pennies per run'],
      ['Clicks, impressions', 'Search Console', 'Needs site ownership'],
    ],
    [26, 40, 34],
  ),
  gap(220),
  p('Roughly 30 to 90 dollars a month at 21 domains. About 12 to 15 dollars per domain at 100.'),

  callout('The expensive input is not data. It is the human time to review what the engine produces.'),

  pageBreak(),
  eyebrow('02 / Research'),
  headline('On GEO and AEO, I separated evidence from folklore.'),

  label('Holds up'),
  bullet('Sourced statistics, quotable lines and citations lift visibility in generative engines by 30 to 40 percent. Princeton and IIT, KDD 2024. The only controlled experiment I found.'),
  bullet('No AI crawler runs JavaScript. A client rendered page can rank fine in Google and be invisible to ChatGPT, Claude and Perplexity.'),
  bullet('The assistants cite very differently. They are separate targets, not one thing called AI search.'),

  label('Does not hold up'),
  bullet('llms.txt. Google says it does not use it. Most deployed files are never fetched.'),
  bullet('Schema as a direct lever on AI citations. No controlled evidence. Still worth emitting for Google and Bing, so it is tagged low confidence rather than dropped.'),

  label('The risk that shaped the design'),
  p('Google enforces against scaled content algorithmically. Across twenty domains, one shared footprint could take down several at once. So publishing is gated by policy and human review, and auto apply is opt in.'),

  callout('Knowing what does not work is also research. I kept the folklore in, labelled as folklore.'),
  pageBreak(),
)

// ---------------------------------------------------------------------------
// 03 From problem to solution
// ---------------------------------------------------------------------------
body.push(
  eyebrow('03 / The solution'),
  headline('Every design decision traces back to a constraint.'),

  table(
    ['Constraint', 'What I did about it'],
    [
      [
        'A new domain must not start a new process',
        'Per property config holds everything specific. The engine holds everything shared. A CI check fails the build if engine code mentions a domain.',
      ],
      [
        'Recommendations must be arguable',
        'Collection writes evidence and nothing else. Detectors turn evidence into gaps. A gap cannot exist without the rows behind it.',
      ],
      [
        'Priority must be recomputable',
        'Scoring is a formula in code, not a model. Every input is stored on the row and printed next to the result.',
      ],
      [
        'The domains have no authority yet',
        'Achievable position is read off the actual search results rather than assumed. A weak page one is winnable, an established one is not.',
      ],
      [
        'Done must mean observed',
        'Each action carries checks a machine can run. Only a fresh fetch can move it to verified.',
      ],
      [
        'Payoff takes months, shipping takes seconds',
        'Two separate questions with separate verdicts, so a correctly shipped fix does not read as a failure for a quarter.',
      ],
      [
        'Scaled content is an existential risk',
        'Generating and publishing are different permissions. A property without deploy access is never written to.',
      ],
    ],
    [34, 66],
  ),

  callout('That table is the whole design. Everything below is how it is implemented.'),
  pageBreak(),
)

// ---------------------------------------------------------------------------
// 04 Architecture
// ---------------------------------------------------------------------------
body.push(
  eyebrow('04 / Architecture'),
  headline('One loop, six stages, immutable snapshots.'),

  mono('collect  ->  detect  ->  score  ->  make  ->  verify  ->  measure'),
  gap(200),
  table(
    ['Stage', 'What happens', 'What it writes'],
    [
      ['Collect', 'Adapters gather from crawl, search, competitors, AI answers', 'Evidence, each row with source and confidence'],
      ['Detect', 'Pure functions filter evidence into typed gaps', 'Opportunities pointing at their evidence'],
      ['Score', 'A formula in code', 'Every factor stored, not just the result'],
      ['Make', 'Writes the asset the gap calls for', 'Action with acceptance criteria, plus the artifact'],
      ['Verify', 'Fetches the page again and checks', 'Status, and what it actually saw'],
      ['Measure', 'Compares the series over a window', 'Improving, flat, declining, too early'],
    ],
    [13, 45, 42],
  ),
  gap(220),
  p('Each run writes a new snapshot and nothing is edited in place. Every question here is a comparison, so history is the primary data rather than a side table.'),

  callout('Adding a property is a config file. The build fails if that stops being true.'),

  pageBreak(),
  eyebrow('04 / Architecture'),
  headline('The tech stack, and why each piece.'),

  table(
    ['Choice', 'Why this one'],
    [
      [
        'TypeScript on Node',
        'The work is almost entirely waiting on network calls, which suits the event loop. One type system also covers the engine, the model output and the UI, which removes a class of bugs where data shape drifts between layers.',
      ],
      [
        'Next.js',
        'One process serves the dashboard, so no separate API to build and deploy. It is also what 8x already runs.',
      ],
      [
        'PostgreSQL with Prisma',
        'I started on SQLite because it made the demo trivial. I moved because "we would use Postgres in production" was the last unproven claim in a submission arguing claims should be demonstrated. jsonb also keeps evidence queryable instead of opaque text.',
      ],
      [
        'Docker and Podman compose',
        'Migrations run as their own one shot service, not on app startup, so replicas cannot race applying them. That is the bug that appears the first time you scale past one instance.',
      ],
      [
        'shadcn/ui and Tailwind',
        'Default theme, nothing bespoke to maintain. The dashboard needs to be readable and honest, not designed.',
      ],
      [
        'Two LLM providers, one interface',
        'Grounding decided this, not the vendor. Every 8x domain launched after any model training cutoff, so a model that cannot search the live web can never cite them. If a provider cannot ground, the probe refuses to run.',
      ],
      [
        'Vitest and GitHub Actions',
        'Unit tests on scoring, contract tests for vendor response drift, golden tests pinning detector output, and one integration test running the whole loop against real Postgres.',
      ],
    ],
    [22, 78],
  ),

  callout('Each choice is reversible along a seam that already exists. That is why the seams are narrow.'),

  pageBreak(),
  eyebrow('04 / Architecture'),
  headline('What it produced.'),

  table(
    ['Gap type', 'Found'],
    [
      ['Keyword', '256'],
      ['Competitor', '92'],
      ['Technical', '60'],
      ['AI visibility', '36'],
    ],
    [64, 36],
  ),
  gap(200),
  p('40 landing pages, 7 blog posts, 5 free tools, 3 comparison pages, 4 technical fixes.'),

  label('The finding I would lead with'),
  mono('"What is the best AI stylist app?"            0 of 3'),
  mono('"Best app to organise my closet digitally"    0 of 3'),
  mono('"What is Cherly app?"                         3 of 3'),
  gap(150),
  p('Known by name, invisible for the category. The assistant recommends acloset, whering and cladwell instead. Those are the three competitors already in that property config.'),

  label('The loop closing'),
  p('On the one property I control, with pages the engine wrote itself, indexable pages went from 3 to 7 after it shipped its own work. Verdict: improving.'),
  p('On your domains it stops at proposed, with the fix attached, because I cannot deploy there.'),

  callout('Nothing says verified where a curl would say otherwise.'),
  pageBreak(),
)

// ---------------------------------------------------------------------------
// 05 Next
// ---------------------------------------------------------------------------
body.push(
  eyebrow('05 / What I would do next'),
  headline('In order, and why that order.'),

  point('1. Feed the detectors that already exist.', 'Ranking and AI visibility are written and tested. They need budget, not design. Cheapest win available.'),
  point('2. The learn loop.', 'The tactic prior in scoring is currently always 1.0. Feeding it per tactic win rates means a tactic that keeps measuring flat gets deprioritised portfolio wide, with nobody editing weights. This is the part that answers how the system gets more useful as you grow.'),
  point('3. Scheduling and the worker split.', 'Runs move out of the web process. The queue lives inside Postgres, so no new infrastructure.'),
  point('4. First party outcome data.', 'Search Console access turns payoff from sampled rankings into measured clicks, against a control group rather than a naive before and after.'),
  point('5. The publishing path.', 'Assets stop at a reviewable artifact today. Pull requests against each property repo is the smallest honest integration.'),

  callout('Point 2 is the one that makes the portfolio compound. Everything else is throughput.'),

  pageBreak(),
  eyebrow('05 / What I would do next'),
  headline('The tactic portfolio, beyond blogs and free tools.'),

  p('You asked for other ways to improve SEO, GEO and AEO. I researched eighteen and systematised sixteen as opportunity types. The bar for inclusion was not whether a tactic works. It was whether it has a machine detectable trigger and a verification metric, because a tactic without both cannot run across twenty properties without a human deciding each time.'),

  table(
    ['Tactic', 'Trigger, and how payoff is checked'],
    [
      ['GEO retrofit blocks', 'Page ranks top 20, an AI answer exists, we are not cited. Citation inclusion rate against an untreated cohort.'],
      ['Original data statistics pages', 'Third party stat pages own the citations and we hold first party data. Citation appearances and referring domains.'],
      ['Comparison and alternatives surfaces', 'Competitors co-occur with the category in sampled answers, we are absent. Brand inclusion rate before and after.'],
      ['Freshness pipeline, real deltas only', 'A cited or ranking page has not substantively changed in 90 to 180 days. Citation retention against a stale cohort.'],
      ['Earned listicle outreach', 'The same third party URL is cited repeatedly for money prompts, we are absent. Recommendation rate after placement.'],
      ['Entity and knowledge graph work', 'No knowledge graph entity, and the "what is brand" probe returns wrong or empty. Branded answer accuracy.'],
      ['PAA mined FAQ blocks', 'Unanswered or competitor owned People Also Ask questions inside a ranked cluster. Ownership per question.'],
      ['Featured snippet capture', 'A snippet exists, we rank 2 to 10, a competitor owns it. Ownership flips on scheduled SERP pulls.'],
      ['AI crawlability baseline', 'No JS parity fails, robots blocks search bots, or Bing coverage is missing. Re-crawl, and bot fetches in logs.'],
      ['Brand answer pages', 'The prompt panel returns factual errors or competitor citations for branded prompts. Own domain citation share.'],
      ['Free tools, AEO upgraded', 'Tool intent queries where assistants recommend competitor tools. Tool recommendation rate in the panel.'],
      ['Programmatic glossaries', 'Definitional citations go to competitor glossaries. Ownership per term, and indexation rate.'],
      ['Disclosed parent brand linking', 'A new domain cold start. Never an anchor text link mesh. Indexation velocity, referring domain diversity.'],
      ['Distribution via the creator network', 'An authority gap blocks an otherwise high impact cluster. Mention volume and assisted citations.'],
      ['Video and podcast co-occurrence', 'Answers cite video for target queries and ours is absent. Citation sampling in the references.'],
      ['llms.txt and markdown mirrors', 'Developer audience property with observed agent fetches. Default off, and labelled folklore rather than a lever.'],
    ],
    [32, 68],
  ),

  gap(200),
  p('Five of these run in the slice today: GEO retrofit, comparison surfaces, free tools, the crawlability baseline and brand answer pages. The rest are detectors over evidence the engine already collects, which is the point of separating collection from interpretation.'),

  callout('A tactic that cannot be triggered and checked is advice, not a system.'),

  pageBreak(),
  eyebrow('05 / What I would do next'),
  headline('What I would want to ask you.'),

  bullet('Could any property grant Search Console access for a test?'),
  bullet('How do the properties publish? That decides how generated assets land.'),
  bullet('Does app store optimisation belong here, or does this stop at the web edge?'),
  bullet('Is human review mandatory everywhere, or can reversible fixes apply themselves on some properties?'),

  label('Where it stands'),
  p('github.com/sarmadnawaz/8x-search-growth-engine. Twenty pull requests, CI green, 57 tests. Six commands to run, no API keys needed to look at it.'),

  label('Said plainly'),
  bullet('I cannot deploy to domains I do not own, so findings there stop at a generated artifact.'),
  bullet('Search outcomes take months. This proves the plumbing, not the payoff.'),
  bullet('Search volume is modelled from autocomplete and capped so it cannot outrank measured data.'),
  bullet('Seeded history is backdated to show what a month looks like. The evidence is real, only the clock is synthetic, and the dashboard says so.'),
)

const doc = new Document({
  creator: 'Sarmad Nawaz',
  title: '8x Search Growth Engine',
  description: 'Problem, research, solution, architecture, next steps',
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
            style: { paragraph: { indent: { left: 360, hanging: 210 } } },
          },
        ],
      },
    ],
  },
  styles: { default: { document: { run: { font: 'Roboto', size: 22, color: INK } } } },
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
