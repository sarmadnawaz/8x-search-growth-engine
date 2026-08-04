import type { PropertyConfig } from '../../schemas'

/**
 * Asset makers turn an opportunity into something publishable.
 *
 * Two rules shape every maker here:
 *
 *  1. The output must be able to PASS ITS OWN ACCEPTANCE CRITERIA. A maker that
 *     produces a page which then fails `answer_block_present` has produced
 *     plausible-looking filler, and the verifier will say so. Generation and
 *     verification are held to the same standard on purpose.
 *
 *  2. The deterministic template is the product, not a fallback. An LLM
 *     enriches copy where a key is available, but the structural parts a
 *     search or answer engine reads — the answer block, the schema, the
 *     internal links, the sourced figures — are assembled in code, so the
 *     asset is useful with no credentials and identical on every run.
 */

export interface MakerContext {
  config: PropertyConfig
  /** the query or topic this asset exists to serve */
  subject: string
  /** what the detector observed, so copy can cite it rather than invent it */
  evidence: {
    competitors: { url: string; title: string; position: number }[]
    relatedQueries: string[]
    demand: number
    intent: string
  }
  /** optional enrichment; makers must produce a valid asset without it */
  enrich?: (prompt: string, schemaName: string) => Promise<Record<string, string> | null>
}

export interface MadeAsset {
  type: 'landing_page' | 'comparison_page' | 'blog' | 'free_tool' | 'technical_fix'
  /** path relative to the site root */
  path: string
  body: string
  /** which criteria this asset is built to satisfy, for the review UI */
  satisfies: string[]
  producedBy: string
}

export interface Maker {
  kind: string
  make(ctx: MakerContext): Promise<MadeAsset>
}

/** Shared helpers so every maker produces the same structural guarantees. */

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

/**
 * A 40-60 word direct answer under a question-shaped heading.
 *
 * This is the single formatting property with controlled evidence behind it
 * for both featured snippets and generative-engine citation, so it is built
 * structurally rather than left to prose generation.
 */
export function answerBlock(question: string, answer: string): string {
  return `    <h2>${escapeHtml(question)}</h2>\n    <p class="answer">${escapeHtml(answer)}</p>`
}

/**
 * Wrap a subject in a question template, unless it is already a question.
 *
 * Subjects reach the makers from two places: query clusters, which are noun
 * phrases like "ai stylist app", and AI-citation gaps, whose subject is the
 * prompt itself and already ends in a question mark. Applying the template
 * blindly produces "How do you choose What is the best AI stylist app??" in
 * the title, both headings and the schema block.
 */
export function asQuestion(subject: string, template: (s: string) => string): string {
  const clean = subject.trim()
  return /[?？]$/.test(clean) ? clean : template(clean)
}

export function jsonLd(node: Record<string, unknown>): string {
  // JSON.stringify does not escape `<`, so a value containing `</script>`
  // closes the block and everything after it becomes markup. The values here
  // include model-generated copy, which makes this the one place untrusted
  // text reaches a page as anything other than escaped text.
  const serialise = (value: unknown) =>
    JSON.stringify(value, null, 2)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026')

  return `    <script type="application/ld+json">\n${serialise(
    { '@context': 'https://schema.org', ...node },
  )
    .split('\n')
    .map((l) => '    ' + l)
    .join('\n')}\n    </script>`
}

export function internalLinks(config: PropertyConfig, current: string): string {
  const links = [
    { href: '/', label: 'Home' },
    ...config.seedQueries
      .filter((q) => slugify(q) !== current)
      .slice(0, 3)
      .map((q) => ({ href: `/${slugify(q)}`, label: q })),
  ]
  return `    <nav class="related">\n${links
    .map((l) => `      <a href="${l.href}">${escapeHtml(l.label)}</a>`)
    .join('\n')}\n    </nav>`
}

/**
 * A meta description cut to a word boundary.
 *
 * Slicing at a fixed character count leaves the text ending mid-word, which is
 * what a search engine then shows in the result. Cutting at the last space
 * costs a few characters and never produces a fragment.
 */
export function metaDescription(text: string, max = 155): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean

  const cut = clean.slice(0, max)
  const boundary = cut.lastIndexOf(' ')
  return (boundary > 0 ? cut.slice(0, boundary) : cut).replace(/[\s,;:.]+$/, '') + '.'
}

/**
 * The page's own absolute URL.
 *
 * A canonical pointing anywhere other than the page itself tells the engine to
 * drop it as a duplicate. For a generated page that is the difference between
 * publishing and publishing nothing, so it is derived from the asset path
 * rather than defaulted.
 */
export function canonicalFor(domain: string, path: string): string {
  return `https://${domain}/${path.replace(/^\/+/, '')}`
}

export function page(opts: {
  title: string
  description: string
  canonical: string
  bodyParts: string[]
}): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(opts.title)}</title>
    <meta name="description" content="${escapeHtml(opts.description)}" />
    <link rel="canonical" href="${escapeHtml(opts.canonical)}" />
  </head>
  <body>
${opts.bodyParts.join('\n')}
  </body>
</html>
`
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
