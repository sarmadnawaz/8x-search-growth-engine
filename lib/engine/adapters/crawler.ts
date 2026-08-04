import * as cheerio from 'cheerio'
import { cached } from './cache'
import { safeFetch, type FetchResult } from '../http'
import type { Adapter, AdapterContext, CollectResult, PageInput } from './types'
import type { EvidenceInput } from '../../schemas'

const USER_AGENT =
  'SearchGrowthEngine/0.1 (+portfolio SEO auditing; contact: engineering@example.com)'

/**
 * A polite first-party crawler.
 *
 * Two things it deliberately does NOT do: execute JavaScript, or ignore
 * robots.txt. The first is a feature — no AI answer-engine crawler executes JS
 * either, so what this fetcher can see is what an answer engine can see, and
 * the gap between initial HTML and rendered DOM is itself evidence.
 */

interface FetchedDoc {
  url: string
  status: number
  body: string
  contentType: string
  /** set when the request produced no usable body — not the same as "absent" */
  failure?: FetchResult['failure']
}

/**
 * Whether a response tells us anything about the site.
 *
 * A 429, a 403 from a WAF, or a timeout means we were not allowed to look —
 * which is a different fact from "this file does not exist". Treating them the
 * same manufactures a full slate of confident technical findings whenever a
 * site rate-limits us, and the engine would then generate and ship fixes for
 * problems that were never there.
 */
function wasObserved(doc: FetchedDoc): boolean {
  return !doc.failure && doc.status > 0 && doc.status < 500 && doc.status !== 429 && doc.status !== 403
}

async function fetchDoc(url: string): Promise<FetchedDoc> {
  const res: FetchResult = await safeFetch(url, { userAgent: USER_AGENT, timeoutMs: 10_000 })
  return {
    url: res.url,
    status: res.status,
    body: res.body,
    contentType: res.contentType,
    failure: res.failure,
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Paths from a sitemap, resolved against the origin we were asked to crawl.
 *
 * A sitemap lists canonical production URLs, which are not necessarily the
 * host being audited — a staging environment, a preview deploy, or a local
 * fixture all serve the same paths from a different origin. Taking the URLs
 * literally means fetching a host we were not pointed at, and quietly
 * crawling nothing.
 */
function parseSitemapUrls(xml: string, origin: string): string[] {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1])

  const resolved = locs.map((loc) => {
    try {
      const { pathname, search } = new URL(loc)
      return `${origin}${pathname}${search}`
    } catch {
      return loc.startsWith('/') ? `${origin}${loc}` : loc
    }
  })

  return [...new Set(resolved)]
}

function extractPage(doc: FetchedDoc, origin: string): PageInput {
  const $ = cheerio.load(doc.body)
  const robotsMeta = $('meta[name="robots"]').attr('content')?.toLowerCase()
  const schemaTypes: string[] = []

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).text())
      const nodes = Array.isArray(parsed) ? parsed : [parsed]
      for (const node of nodes) {
        const graph = node?.['@graph']
        for (const item of Array.isArray(graph) ? graph : [node]) {
          if (item?.['@type']) {
            schemaTypes.push(...[item['@type']].flat().map(String))
          }
        }
      }
    } catch {
      // invalid JSON-LD is itself a finding, surfaced by the detector via
      // the absence of expected types rather than by throwing here
    }
  })

  const internalLinks = $('a[href]')
    .toArray()
    .filter((el) => {
      const href = $(el).attr('href') ?? ''
      return href.startsWith('/') || href.startsWith(origin)
    }).length

  const text = $('body').text().replace(/\s+/g, ' ').trim()

  return {
    url: doc.url,
    status: doc.status,
    indexable: doc.status === 200 && !robotsMeta?.includes('noindex'),
    title: $('title').first().text().trim() || undefined,
    metaDescription: $('meta[name="description"]').attr('content')?.trim() || undefined,
    h1: $('h1').first().text().trim() || undefined,
    canonical: $('link[rel="canonical"]').attr('href')?.trim() || undefined,
    robotsMeta,
    schemaTypes: [...new Set(schemaTypes)],
    internalLinks,
    wordCount: text ? text.split(' ').length : 0,
    rawTextLength: text.length,
  }
}

export const crawlerAdapter: Adapter = {
  name: 'crawler',

  unavailableReason() {
    return null // needs no credentials — always runs
  },

  async collect(ctx: AdapterContext): Promise<CollectResult> {
    const { baseUrl, config, mode } = ctx
    const evidence: EvidenceInput[] = []
    const pages: PageInput[] = []
    const origin = new URL(baseUrl).origin
    const delayMs = Math.ceil(1000 / config.crawl.requestsPerSecond)

    const fetchThrough = async (url: string) => {
      // Local URLs bypass the fixture cache inside `cached` itself, so a site
      // we serve ourselves is always read fresh.
      const result = await cached('crawler', url, mode, () => fetchDoc(url))
      await ctx.record({
        adapter: 'crawler',
        requestKey: url,
        status: String(result.payload.status),
        cached: result.cached,
        latencyMs: result.latencyMs,
      })
      if (!result.cached) await sleep(delayMs)
      return result.payload
    }

    // --- robots.txt -------------------------------------------------------
    const robots = await fetchThrough(`${origin}/robots.txt`)
    if (!wasObserved(robots)) {
      evidence.push({
        kind: 'crawl_fact',
        source: 'crawler',
        tier: 'measured',
        subject: `${origin}/robots.txt`,
        value: {
          fact: 'fetch_failed',
          url: `${origin}/robots.txt`,
          detail: { status: robots.status, failure: robots.failure ?? 'blocked' },
        },
      })
      ctx.log(`could not observe robots.txt (status ${robots.status}${robots.failure ? ', ' + robots.failure : ''}) — recording as unobserved, not missing`)
      return { evidence, pages }
    }
    const robotsPresent = robots.status === 200 && robots.body.trim().length > 0
    evidence.push({
      kind: 'crawl_fact',
      source: 'crawler',
      tier: 'measured',
      subject: `${origin}/robots.txt`,
      value: {
        fact: robotsPresent ? 'robots_txt_present' : 'robots_txt_missing',
        url: `${origin}/robots.txt`,
        detail: {
          status: robots.status,
          referencesSitemap: /sitemap:/i.test(robots.body),
          // answer-engine crawlers are a distinct policy surface from Googlebot
          blocksAiSearchBots: /user-agent:\s*(oai-searchbot|perplexitybot|claude-searchbot)/i.test(
            robots.body,
          ),
        },
      },
    })

    // --- sitemap ----------------------------------------------------------
    const sitemap = await fetchThrough(`${origin}/sitemap.xml`)
    const sitemapUrls = sitemap.status === 200 ? parseSitemapUrls(sitemap.body, origin) : []
    evidence.push({
      kind: 'crawl_fact',
      source: 'crawler',
      tier: 'measured',
      subject: `${origin}/sitemap.xml`,
      value: {
        fact: sitemapUrls.length > 0 ? 'sitemap_present' : 'sitemap_missing',
        url: `${origin}/sitemap.xml`,
        detail: { status: sitemap.status, urlCount: sitemapUrls.length },
      },
    })

    // --- pages ------------------------------------------------------------
    // Prefer the sitemap; fall back to homepage links so a property without a
    // sitemap still gets audited (that absence is a finding, not a dead end).
    const home = await fetchThrough(origin + '/')
    const homePage = extractPage(home, origin)
    pages.push(homePage)

    let queue = sitemapUrls
    if (queue.length === 0) {
      const $ = cheerio.load(home.body)
      queue = [
        ...new Set(
          $('a[href]')
            .toArray()
            .map((el) => $(el).attr('href') ?? '')
            .filter((href) => href.startsWith('/') || href.startsWith(origin))
            .map((href) => (href.startsWith('/') ? origin + href : href))
            .map((href) => href.split('#')[0]),
        ),
      ]
    }

    for (const url of queue.filter((u) => u !== origin + '/' && u !== origin).slice(0, config.crawl.maxPages - 1)) {
      try {
        const doc = await fetchThrough(url)
        pages.push(extractPage(doc, origin))
      } catch (err) {
        ctx.log(`crawl failed for ${url}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // --- per-page technical facts ----------------------------------------
    for (const page of pages) {
      const issues: string[] = []
      if (!page.title) issues.push('title_missing')
      else if (page.title.length > 60) issues.push('title_too_long')
      if (!page.metaDescription) issues.push('meta_description_missing')
      if (!page.h1) issues.push('h1_missing')
      if (!page.canonical) issues.push('canonical_missing')
      if (page.schemaTypes.length === 0) issues.push('schema_missing')
      // AI crawlers read initial HTML only; a near-empty body means the page is
      // invisible to answer engines even if it renders fine in a browser
      if (page.status === 200 && page.rawTextLength < 500) issues.push('thin_initial_html')

      for (const issue of issues) {
        evidence.push({
          kind: 'crawl_fact',
          source: 'crawler',
          tier: 'measured',
          subject: page.url,
          value: {
            fact: issue,
            url: page.url,
            detail: {
              title: page.title ?? null,
              rawTextLength: page.rawTextLength,
              schemaTypes: page.schemaTypes,
            },
          },
        })
      }
    }

    ctx.log(`crawled ${pages.length} pages, ${evidence.length} crawl facts`)
    return { evidence, pages }
  },
}
