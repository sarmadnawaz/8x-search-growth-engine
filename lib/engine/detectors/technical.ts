import type { Detector, DetectorInput } from './types'
import { value } from './types'
import type { OpportunityDraft } from '../../schemas'

interface CrawlFactValue {
  fact: string
  url: string
  detail: Record<string, unknown>
}

/**
 * Severity classes for technical findings.
 *
 * The distinction that matters: a 404 robots.txt is NOT an indexation blocker —
 * Google treats a missing robots.txt as allow-all. Calling it one would inflate
 * a discovery-hygiene fix into an emergency and discredit the blocker class for
 * the cases that genuinely earn it (noindex on money pages, Disallow: /, a
 * robots.txt returning 5xx, canonical loops).
 */
const SEVERITY: Record<string, { severity: number; blocker: boolean; label: string }> = {
  robots_txt_blocking: { severity: 10, blocker: true, label: 'robots.txt blocks all crawling' },
  noindex_on_money_page: { severity: 9, blocker: true, label: 'noindex on an indexable page' },
  robots_txt_missing: { severity: 2.5, blocker: false, label: 'robots.txt missing' },
  sitemap_missing: { severity: 2.5, blocker: false, label: 'XML sitemap missing' },
  thin_initial_html: {
    severity: 3,
    blocker: false,
    label: 'content invisible to answer-engine crawlers (thin initial HTML)',
  },
  canonical_missing: { severity: 1.5, blocker: false, label: 'canonical link missing' },
  schema_missing: { severity: 1.5, blocker: false, label: 'structured data missing' },
  meta_description_missing: { severity: 1, blocker: false, label: 'meta description missing' },
  title_missing: { severity: 2, blocker: false, label: 'title missing' },
  title_too_long: { severity: 0.8, blocker: false, label: 'title over 60 characters' },
  h1_missing: { severity: 1.2, blocker: false, label: 'h1 missing' },
}

/** Findings are grouped to template level: one row for 34 pages, not 34 rows. */
export const technicalDetector: Detector = {
  id: 'technical-hygiene',
  version: '1.0.0',
  description:
    'Groups crawl facts by type, weights them by severity and page coverage, and proposes a fix with machine-checkable criteria.',

  run({ config, evidence, pages }: DetectorInput): OpportunityDraft[] {
    const crawlFacts = evidence.filter((e) => e.kind === 'crawl_fact')
    const byFact = new Map<string, typeof crawlFacts>()

    for (const row of crawlFacts) {
      const v = value<CrawlFactValue>(row)
      if (!SEVERITY[v.fact]) continue
      const list = byFact.get(v.fact) ?? []
      list.push(row)
      byFact.set(v.fact, list)
    }

    const pageCount = Math.max(1, pages.length)
    const drafts: OpportunityDraft[] = []

    for (const [fact, rows] of byFact) {
      const meta = SEVERITY[fact]
      const urls = rows.map((r) => value<CrawlFactValue>(r).url)
      // Site-level facts affect the whole property; page-level facts affect the
      // share of pages they were found on.
      const siteLevel = fact === 'robots_txt_missing' || fact === 'sitemap_missing'
      const coverage = siteLevel ? 1 : Math.min(1, rows.length / pageCount)

      drafts.push({
        type: 'technical',
        detectorId: technicalDetector.id,
        detectorVersion: technicalDetector.version,
        title: siteLevel
          ? meta.label
          : `${meta.label} on ${rows.length} of ${pageCount} crawled pages`,
        subject: siteLevel ? config.domain : urls[0],
        evidenceIds: rows.map((r) => r.id),
        isBlocker: meta.blocker,
        impactInputs: {
          demand: 0,
          headroom: 0,
          coverage,
          severity: meta.severity,
          citationHeadroom: 0,
          aiOverviewPresent: false,
        },
        effortClass: siteLevel ? 'technical_fix' : 'page_edit',
        weakestTier: 'measured',
        sourceCount: 1,
        sampleDiscount: 1,
        suggestedAction: buildAction(fact, meta.label, urls, config.domain),
      })
    }

    return drafts
  },
}

/**
 * Acceptance criteria are the point of an action: each one is a check a
 * collector can re-run, so "done" is observed rather than asserted.
 */
function buildAction(fact: string, label: string, urls: string[], domain: string) {
  switch (fact) {
    case 'robots_txt_missing':
      return {
        kind: 'ship_robots_txt',
        title: `Publish robots.txt for ${domain}`,
        spec:
          'Publish a robots.txt that allows crawling, references the XML sitemap, and explicitly ' +
          'permits answer-engine crawlers (OAI-SearchBot, PerplexityBot, Claude-SearchBot).',
        criteria: [
          { id: 'robots_200', description: '/robots.txt returns 200', check: 'http_status:/robots.txt=200' },
          {
            id: 'robots_sitemap_ref',
            description: 'robots.txt references the sitemap',
            check: 'body_contains:/robots.txt=Sitemap:',
          },
          {
            id: 'discovery_outcome',
            description: 'Indexable pages grow after the fix (measured, not re-fetched)',
            check: 'indexed_pages_min:1',
          },
        ],
      }
    case 'sitemap_missing':
      return {
        kind: 'ship_sitemap',
        title: `Publish an XML sitemap for ${domain}`,
        spec: 'Generate sitemap.xml covering every indexable public route, and reference it from robots.txt.',
        criteria: [
          { id: 'sitemap_200', description: '/sitemap.xml returns 200', check: 'http_status:/sitemap.xml=200' },
          {
            id: 'sitemap_has_urls',
            description: 'sitemap lists at least one URL',
            check: 'body_contains:/sitemap.xml=<loc>',
          },
          {
            id: 'discovery_outcome',
            description: 'Indexable pages grow after the fix (measured, not re-fetched)',
            check: 'indexed_pages_min:1',
          },
        ],
      }
    case 'thin_initial_html':
      return {
        kind: 'server_render_content',
        title: 'Server-render the primary content on thin pages',
        spec:
          'These pages return almost no text in the initial HTML. No AI answer-engine crawler ' +
          'executes JavaScript, so this content is invisible to them even though it renders in a ' +
          'browser. Server-render the main copy.',
        criteria: urls.slice(0, 5).map((url, i) => ({
          id: `ssr_${i}`,
          description: `${url} returns substantive text in initial HTML`,
          check: `min_text_length:${new URL(url).pathname}=500`,
        })),
      }
    default:
      return {
        kind: 'fix_page_metadata',
        title: label,
        spec: `Resolve "${label}" on the affected pages.`,
        criteria: urls.slice(0, 5).map((url, i) => ({
          id: `fixed_${i}`,
          description: `${label} resolved on ${url}`,
          check: `crawl_fact_absent:${fact}@${new URL(url).pathname}`,
        })),
      }
  }
}
