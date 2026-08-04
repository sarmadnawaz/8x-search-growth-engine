import {
  answerBlock,
  escapeHtml,
  internalLinks,
  jsonLd,
  page,
  slugify,
  type Maker,
  type MakerContext,
  type MadeAsset,
} from './types'

/**
 * The maker library: the three asset types the assignment names — landing
 * pages, blogs, free tools — plus a comparison page, since "X vs Y" is the
 * page type answer engines cite most for commercial queries.
 *
 * Every asset is built to pass the acceptance criteria its own action carries.
 * That is the check on this whole stage: if a maker emits filler, the verifier
 * fails it, and the failure is visible in the dashboard rather than hidden
 * behind a plausible-looking draft.
 */

// ---------------------------------------------------------------------------

const landingPage: Maker = {
  kind: 'publish_landing_page',

  async make(ctx: MakerContext): Promise<MadeAsset> {
    const { config, subject, evidence } = ctx
    const slug = slugify(subject)
    const question = `What is the best ${subject}?`

    const enriched = await ctx.enrich?.(
      `Write a 45-word direct answer to "${question}" for ${config.name}, which is: ${config.description}. ` +
        `Plain sentences, no marketing adjectives, factually cautious. Also write a one-sentence page title.`,
      'landing_copy',
    )

    const answer =
      enriched?.answer ??
      `${config.name} is ${config.description.trim().replace(/\.$/, '')}. ` +
        `It is built for people searching for ${subject}, and the fastest way to try it is through the ${config.conversionRoute.replace(/_/g, ' ')}.`

    const title = enriched?.title ?? `${subject}, ${config.name}`

    // Competitors come from observed SERP evidence, so the comparison is
    // sourced rather than asserted.
    const competitorList = evidence.competitors.length
      ? `    <h2>What else ranks for this</h2>\n    <ul>\n` +
        evidence.competitors
          .slice(0, 5)
          .map(
            (c) =>
              `      <li>#${c.position} <a href="${escapeHtml(c.url)}" rel="nofollow">${escapeHtml(c.title)}</a></li>`,
          )
          .join('\n') +
        '\n    </ul>'
      : ''

    const related = evidence.relatedQueries.length
      ? `    <h2>Related questions people ask</h2>\n    <ul>\n` +
        evidence.relatedQueries
          .slice(0, 6)
          .map((q) => `      <li>${escapeHtml(q)}</li>`)
          .join('\n') +
        '\n    </ul>'
      : ''

    return {
      type: 'landing_page',
      path: `${slug}.html`,
      producedBy: enriched ? 'template+llm' : 'template',
      satisfies: ['answer_block_present', 'internal_links_min:3', 'schema_type_present:FAQPage'],
      body: page({
        title,
        description: answer.slice(0, 155),
        bodyParts: [
          `    <h1>${escapeHtml(title)}</h1>`,
          answerBlock(question, answer),
          competitorList,
          related,
          internalLinks(config, slug),
          jsonLd({
            '@type': 'FAQPage',
            mainEntity: [
              {
                '@type': 'Question',
                name: question,
                acceptedAnswer: { '@type': 'Answer', text: answer },
              },
            ],
          }),
        ].filter(Boolean),
      }),
    }
  },
}

// ---------------------------------------------------------------------------

const comparisonPage: Maker = {
  kind: 'publish_comparison_page',

  async make(ctx: MakerContext): Promise<MadeAsset> {
    const { config, subject, evidence } = ctx
    const rivals = evidence.competitors.slice(0, 3)
    const slug = slugify(`${config.name} vs ${rivals[0]?.title ?? 'alternatives'}`)
    const question = `How does ${config.name} compare for ${subject}?`

    const answer =
      `${config.name} ${config.description.trim().replace(/\.$/, '')}. ` +
      `The comparison below is built from the results currently ranking for "${subject}", ` +
      `and lists what each option is for rather than claiming a winner.`

    const rows = [
      `      <tr><th scope="row">${escapeHtml(config.name)}</th><td>${escapeHtml(config.description.slice(0, 90))}</td><td>ranked: not yet</td></tr>`,
      ...rivals.map(
        (r) =>
          `      <tr><th scope="row">${escapeHtml(r.title.slice(0, 50))}</th><td><a href="${escapeHtml(r.url)}" rel="nofollow">${escapeHtml(new URL(r.url).hostname)}</a></td><td>ranked #${r.position}</td></tr>`,
      ),
    ]

    return {
      type: 'comparison_page',
      path: `${slug}.html`,
      producedBy: 'template',
      satisfies: ['answer_block_present', 'internal_links_min:3'],
      body: page({
        title: `${config.name} vs alternatives for ${subject}`,
        description: answer.slice(0, 155),
        bodyParts: [
          `    <h1>${escapeHtml(config.name)} vs alternatives for ${escapeHtml(subject)}</h1>`,
          answerBlock(question, answer),
          // A real HTML table, because answer engines extract tables and
          // ignore visual grids built from divs.
          `    <table>\n      <caption>Options currently ranking for "${escapeHtml(subject)}"</caption>\n      <thead><tr><th>Option</th><th>What it is</th><th>Current position</th></tr></thead>\n      <tbody>\n${rows.join('\n')}\n      </tbody>\n    </table>`,
          internalLinks(config, slug),
        ],
      }),
    }
  },
}

// ---------------------------------------------------------------------------

const blogPost: Maker = {
  kind: 'publish_blog',

  async make(ctx: MakerContext): Promise<MadeAsset> {
    const { config, subject, evidence } = ctx
    const slug = slugify(subject)
    const question = `How do you choose ${subject}?`

    const enriched = await ctx.enrich?.(
      `Write three short paragraphs (60 words each) answering "${question}" for readers considering ${config.name} (${config.description}). ` +
        `Practical and specific. Return keys: intro, body, conclusion.`,
      'blog_copy',
    )

    const answer =
      enriched?.intro ??
      `Choosing ${subject} comes down to the job you need done. ` +
        `This page sets out what to compare, which questions people actually search alongside it, ` +
        `and where ${config.name} fits, including where it does not.`

    // Figures are drawn from measured evidence and cited to their source, so
    // the page can satisfy `sourced_stats` honestly rather than by inventing
    // numbers, which is the failure mode of generated content.
    const stats = [
      evidence.relatedQueries.length > 0
        ? `<li>${evidence.relatedQueries.length} related searches were observed for this topic (<a href="https://www.google.com/search?q=${encodeURIComponent(subject)}">Google autocomplete</a>).</li>`
        : '',
      evidence.competitors.length > 0
        ? `<li>${evidence.competitors.length} distinct results currently rank on page one (<a href="https://www.google.com/search?q=${encodeURIComponent(subject)}">Google search results</a>).</li>`
        : '',
      `<li>Demand signal for this topic scored ${evidence.demand.toFixed(1)} of 10 in our own index (<a href="/methodology.html">methodology</a>).</li>`,
    ].filter(Boolean)

    return {
      type: 'blog',
      path: `blog/${slug}.html`,
      producedBy: enriched ? 'template+llm' : 'template',
      satisfies: ['answer_block_present', 'sourced_stats:3', 'internal_links_min:3'],
      body: page({
        title: `${question}, ${config.name}`,
        description: answer.slice(0, 155),
        bodyParts: [
          `    <h1>${escapeHtml(question)}</h1>`,
          answerBlock(question, answer),
          `    <h2>What the data shows</h2>\n    <ul>\n      ${stats.join('\n      ')}\n    </ul>`,
          enriched?.body ? `    <p>${escapeHtml(enriched.body)}</p>` : '',
          `    <h2>Where ${escapeHtml(config.name)} fits</h2>\n    <p>${escapeHtml(enriched?.conclusion ?? config.description)}</p>`,
          internalLinks(config, slug),
          jsonLd({
            '@type': 'Article',
            headline: question,
            description: answer.slice(0, 155),
          }),
        ].filter(Boolean),
      }),
    }
  },
}

// ---------------------------------------------------------------------------

/**
 * A free tool, in the Shortimize pattern: a narrow utility that does one job
 * with no signup, and routes to the product.
 *
 * It ships as a working, self-contained page rather than a specification —
 * a spec is a document about an asset, not an asset. The calculator logic is
 * chosen from the query's own shape, so the tool matches the search intent
 * that justified building it.
 */
const freeTool: Maker = {
  kind: 'build_free_tool',

  async make(ctx: MakerContext): Promise<MadeAsset> {
    const { config, subject } = ctx
    const slug = slugify(subject)
    const question = `What does this ${subject} do?`

    const spec = toolSpecFor(subject)

    // No utility shape fits this query, so the maker produces a brief for a
    // human instead of a calculator that computes something nobody asked for.
    if (!spec.label) {
      return {
        type: 'free_tool',
        path: `tools/${slug}.brief.md`,
        producedBy: 'template',
        satisfies: [],
        body:
          `# Tool brief, ${subject}\n\n` +
          `The engine detected tool intent for "${subject}" but has no utility template that ` +
          `matches this job, so it has not generated one. Shipping a generic calculator here ` +
          `would create a page that ranks for a query it does not answer.\n\n` +
          `**What the evidence supports**\n\n` +
          `- Demand signal: ${ctx.evidence.demand.toFixed(1)}/10\n` +
          `- Related searches observed: ${ctx.evidence.relatedQueries.slice(0, 8).join(', ') || 'none recorded'}\n` +
          `- Currently ranking: ${ctx.evidence.competitors.map((c) => `#${c.position} ${c.title}`).slice(0, 3).join('; ') || 'no results captured'}\n\n` +
          `**Next step**: define the one job this tool should do in a single step, then add a ` +
          `template for it in \`lib/engine/makers\`. It becomes available to every property at once.\n`,
      }
    }

    const answer =
      `This ${spec.label.toLowerCase()} answers "${subject}" in one step, with no signup. ` +
      `Enter your numbers and the result updates immediately. It is free, and it is made by ${config.name}.`

    const script = `
      (function () {
        var form = document.getElementById('tool');
        var out = document.getElementById('result');
        function compute() {
          var values = ${JSON.stringify(spec.fields.map((f) => f.id))}.map(function (id) {
            return parseFloat(document.getElementById(id).value) || 0;
          });
          out.textContent = ${JSON.stringify(spec.formulaLabel)} + ': ' + (${spec.formula});
        }
        form.addEventListener('input', compute);
        compute();
      })();`

    return {
      type: 'free_tool',
      path: `tools/${slug}.html`,
      producedBy: 'template',
      satisfies: [
        'answer_block_present',
        'internal_links_min:3',
        'schema_type_present:SoftwareApplication',
      ],
      body: page({
        title: `${spec.label}, free, no signup | ${config.name}`,
        description: answer.slice(0, 155),
        bodyParts: [
          `    <h1>${escapeHtml(spec.label)}</h1>`,
          answerBlock(question, answer),
          `    <form id="tool">\n${spec.fields
            .map(
              (f) =>
                `      <label for="${f.id}">${escapeHtml(f.label)}</label>\n      <input id="${f.id}" type="number" value="${f.value}" />`,
            )
            .join('\n')}\n    </form>\n    <p id="result" role="status"></p>`,
          // The explanation is server-rendered: answer-engine crawlers do not
          // run JavaScript, so a tool whose value exists only after hydration
          // is invisible to them.
          `    <h2>How it works</h2>\n    <p>${escapeHtml(spec.explanation)}</p>`,
          internalLinks(config, slug),
          jsonLd({
            '@type': 'SoftwareApplication',
            name: spec.label,
            applicationCategory: 'UtilitiesApplication',
            offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
          }),
          `    <script>${script}</script>`,
        ],
      }),
    }
  },
}

interface ToolSpec {
  label: string
  fields: { id: string; label: string; value: number }[]
  formula: string
  formulaLabel: string
  explanation: string
}

/** Pick a utility shape from the query, so the tool serves the actual intent. */
function toolSpecFor(subject: string): ToolSpec {
  const q = subject.toLowerCase()

  if (/budget|spend|saving|income|paycheck|invoice/.test(q)) {
    return {
      label: 'Envelope budget split calculator',
      fields: [
        { id: 'income', label: 'Take-home per paycheck', value: 2000 },
        { id: 'essentials', label: 'Essentials (%)', value: 50 },
        { id: 'goals', label: 'Goals (%)', value: 20 },
      ],
      formula:
        "'essentials ' + (values[0]*values[1]/100).toFixed(0) + ', goals ' + (values[0]*values[2]/100).toFixed(0) + ', flexible ' + (values[0]*(100-values[1]-values[2])/100).toFixed(0)",
      formulaLabel: 'Per paycheck',
      explanation:
        'Each paycheck is divided into envelopes by percentage, so the split scales with irregular income instead of assuming a fixed monthly salary.',
    }
  }

  if (/stretch|mobility|fitness|workout|routine/.test(q)) {
    return {
      label: 'Desk-break stretch planner',
      fields: [
        { id: 'hours', label: 'Hours seated per day', value: 8 },
        { id: 'minutes', label: 'Minutes per break', value: 3 },
      ],
      formula:
        "Math.round(values[0]/2) + ' breaks, ' + (Math.round(values[0]/2)*values[1]) + ' minutes total'",
      formulaLabel: 'Daily plan',
      explanation:
        'A break every two seated hours, at the length you choose. The total is what actually gets scheduled, which is the number people underestimate.',
    }
  }

  if (/outfit|wardrobe|closet|stylist|wear|clothing/.test(q)) {
    return {
      label: 'Wardrobe cost-per-wear calculator',
      fields: [
        { id: 'price', label: 'Item price', value: 120 },
        { id: 'wears', label: 'Times worn so far', value: 12 },
        { id: 'planned', label: 'Times you expect to wear it again', value: 20 },
      ],
      formula:
        "'now ' + (values[0]/Math.max(1,values[1])).toFixed(2) + ', projected ' + (values[0]/Math.max(1,values[1]+values[2])).toFixed(2)",
      formulaLabel: 'Cost per wear',
      explanation:
        'Cost per wear is price divided by how often a piece actually gets worn. It is the number that decides whether something was worth buying, and the one people never calculate at the till.',
    }
  }

  // No matching utility shape. Rather than shipping a meaningless
  // "items x rate" calculator, the maker declines and the action stays as a
  // brief for a human — a tool nobody needs is worse than no tool.
  return {
    label: '',
    fields: [],
    formula: '',
    formulaLabel: '',
    explanation: '',
  }
}

// ---------------------------------------------------------------------------

export const MAKERS: Maker[] = [
  landingPage,
  comparisonPage,
  blogPost,
  // The GEO retrofit tactic asks for exactly what the blog maker builds: an
  // answer-first page carrying sourced statistics. Same maker, different
  // trigger — the tactic with controlled evidence behind it (Princeton, KDD
  // 2024) rather than a second template that would drift from the first.
  { ...blogPost, kind: 'geo_retrofit' },
  freeTool,
]

export function makerFor(kind: string): Maker | undefined {
  return MAKERS.find((m) => m.kind === kind)
}
