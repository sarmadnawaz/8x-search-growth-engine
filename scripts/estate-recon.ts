/**
 * Estate recon — the pass that runs *before* onboarding.
 *
 *   npm run recon                # crawl every candidate in properties/_estate.recon.yaml
 *   npm run recon -- --replay    # offline, from recorded fixtures
 *   npm run recon -- --write     # also write docs/07-estate-baseline.md's data table
 *
 * Why this exists as its own entry point:
 *
 * The pipeline answers "what should we do about this property?" — it needs a
 * config: markets, seed queries, competitors, a prompt panel, fit weights.
 * Writing that config is a real decision, and across 20+ domains you need to
 * know which properties deserve it first.
 *
 * Recon answers the prior question — "which of these domains is worst off?" —
 * using only the evidence family that needs no configuration at all: what a
 * crawler can see. It is deliberately narrow. It runs the *same* crawler
 * adapter and the *same* technical detector as the full pipeline, so a finding
 * here is the finding the pipeline would produce, not a lookalike from a
 * throwaway script. Nothing it observes needs an API key.
 *
 * It writes no database rows on purpose: recon is reconnaissance, and a
 * property earns a snapshot history by being onboarded, not by being scanned.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import type { Evidence, Page } from '@prisma/client'
import { loadEnv } from '../lib/env'
import { crawlerAdapter } from '../lib/engine/adapters/crawler'
import { technicalDetector } from '../lib/engine/detectors/technical'
import { score } from '../lib/engine/scoring'
import { PropertyConfig } from '../lib/schemas'
import type { AdapterContext } from '../lib/engine/adapters/types'

loadEnv()

interface Candidate {
  domain: string
  name: string
  note?: string
}

interface CrawlFactValue {
  fact: string
  url: string
  detail: Record<string, unknown>
}

interface DomainReport {
  domain: string
  name: string
  note?: string
  reachable: boolean
  error?: string
  pagesCrawled: number
  facts: Record<string, number>
  robots: { present: boolean; referencesSitemap: boolean; blocksAiSearchBots: boolean }
  sitemapUrls: number
  findings: { title: string; score: number; blocker: boolean }[]
}

const ROOT = process.cwd()

function loadCandidates(): { candidates: Candidate[]; crawl: { maxPages: number; requestsPerSecond: number } } {
  const raw = parse(readFileSync(join(ROOT, 'properties', '_estate.recon.yaml'), 'utf8'))
  return {
    candidates: raw.candidates as Candidate[],
    crawl: raw.crawl ?? { maxPages: 6, requestsPerSecond: 1 },
  }
}

/**
 * A recon config is a property config with every configured field left at its
 * default. That is the point: whatever recon finds, it found without anyone
 * tuning anything for this domain.
 */
function reconConfig(candidate: Candidate, crawl: { maxPages: number; requestsPerSecond: number }) {
  return PropertyConfig.parse({
    domain: candidate.domain,
    name: candidate.name,
    description: 'Recon only — no property config has been written for this domain yet.',
    goal: 'app_installs',
    conversionRoute: 'app_store_link',
    markets: [{ market: 'us', language: 'en' }],
    crawl,
    deployAccess: false,
  })
}

async function reconOne(
  candidate: Candidate,
  crawl: { maxPages: number; requestsPerSecond: number },
  mode: 'live' | 'replay',
): Promise<DomainReport> {
  const config = reconConfig(candidate, crawl)
  const base: DomainReport = {
    domain: candidate.domain,
    name: candidate.name,
    note: candidate.note,
    reachable: false,
    pagesCrawled: 0,
    facts: {},
    robots: { present: false, referencesSitemap: false, blocksAiSearchBots: false },
    sitemapUrls: 0,
    findings: [],
  }

  const ctx: AdapterContext = {
    config,
    snapshotId: 'recon',
    mode,
    baseUrl: `https://${candidate.domain}`,
    clusters: [],
    log: (message) => console.log(`    ${message}`),
    record: async () => {},
  }

  let result
  try {
    result = await crawlerAdapter.collect(ctx)
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) }
  }

  // Evidence rows are in-memory here; detectors index them by id, so synthesise
  // stable ones rather than reaching for a database we deliberately don't touch.
  const evidence = (result.evidence ?? []).map(
    (row, i) => ({ ...row, id: `${candidate.domain}-e${i}` }) as unknown as Evidence,
  )
  const pages = (result.pages ?? []) as unknown as Page[]

  const facts: Record<string, number> = {}
  let robots = base.robots
  let sitemapUrls = 0
  for (const row of evidence) {
    if (row.kind !== 'crawl_fact') continue
    const v = row.value as unknown as CrawlFactValue
    facts[v.fact] = (facts[v.fact] ?? 0) + 1
    if (v.fact === 'robots_txt_present') {
      robots = {
        present: true,
        referencesSitemap: Boolean(v.detail.referencesSitemap),
        blocksAiSearchBots: Boolean(v.detail.blocksAiSearchBots),
      }
    }
    if (v.fact === 'sitemap_present') sitemapUrls = Number(v.detail.urlCount ?? 0)
  }

  const findings = technicalDetector
    .run({ config, evidence, pages, clusters: [] })
    .map((draft) => ({
      title: draft.title,
      score: Number(score(draft, config).rawScore.toFixed(2)),
      blocker: draft.isBlocker,
    }))
    .sort((a, b) => Number(b.blocker) - Number(a.blocker) || b.score - a.score)

  return {
    ...base,
    reachable: pages.length > 0,
    pagesCrawled: pages.length,
    facts,
    robots,
    sitemapUrls,
    findings,
  }
}

function cell(report: DomainReport, fact: string): string {
  if (!report.reachable) return '—'
  const hit = report.facts[fact] ?? 0
  if (hit === 0) return '✓'
  const siteLevel = fact === 'robots_txt_missing' || fact === 'sitemap_missing'
  return siteLevel ? '**missing**' : `${hit}/${report.pagesCrawled}`
}

function markdownTable(reports: DomainReport[]): string {
  const header =
    '| Domain | Pages | robots.txt | sitemap.xml | canonical | schema | meta desc | thin HTML | top finding |\n' +
    '|---|---|---|---|---|---|---|---|---|'
  const rows = reports.map((r) => {
    if (!r.reachable) {
      return `| \`${r.domain}\` | — | — | — | — | — | — | — | unreachable: ${r.error ?? 'no pages returned'} |`
    }
    const top = r.findings[0]
    return [
      `\`${r.domain}\``,
      String(r.pagesCrawled),
      cell(r, 'robots_txt_missing'),
      cell(r, 'sitemap_missing'),
      cell(r, 'canonical_missing'),
      cell(r, 'schema_missing'),
      cell(r, 'meta_description_missing'),
      cell(r, 'thin_initial_html'),
      top ? `${top.title}${top.blocker ? ' **(blocker)**' : ''}` : 'no technical findings',
    ]
      .map((c) => ` ${c} `)
      .join('|')
      .replace(/^/, '|')
      .concat('|')
  })
  return [header, ...rows].join('\n')
}

async function main() {
  const mode = process.argv.includes('--replay') ? 'replay' : 'live'
  const shouldWrite = process.argv.includes('--write')
  const { candidates, crawl } = loadCandidates()

  console.log(`estate recon: ${candidates.length} candidate domains (${mode})\n`)
  const reports: DomainReport[] = []
  for (const candidate of candidates) {
    process.stdout.write(`  ${candidate.domain} ... `)
    const report = await reconOne(candidate, crawl, mode)
    reports.push(report)
    console.log(
      report.reachable
        ? `${report.pagesCrawled} pages, ${report.findings.length} findings`
        : `unreachable (${report.error ?? 'no pages'})`,
    )
  }

  const table = markdownTable(reports)
  console.log(`\n${table}\n`)

  const out = {
    generatedAt: new Date().toISOString(),
    mode,
    crawl,
    reports,
  }
  mkdirSync(join(ROOT, 'fixtures', 'estate'), { recursive: true })
  const jsonPath = join(ROOT, 'fixtures', 'estate', 'recon.json')
  writeFileSync(jsonPath, JSON.stringify(out, null, 2))
  console.log(`raw: ${jsonPath}`)

  if (shouldWrite) {
    const tablePath = join(ROOT, 'docs', 'estate-table.generated.md')
    writeFileSync(tablePath, `${table}\n`)
    console.log(`table: ${tablePath}`)
  }

  const reachable = reports.filter((r) => r.reachable)
  const missingBoth = reachable.filter(
    (r) => r.facts.robots_txt_missing && r.facts.sitemap_missing,
  )
  console.log(
    `\n${reachable.length}/${reports.length} reachable · ` +
      `${missingBoth.length} missing both robots.txt and sitemap.xml`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
