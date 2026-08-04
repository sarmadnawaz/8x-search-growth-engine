import type { Detector, DetectorInput } from './types'
import { value } from './types'
import type { OpportunityDraft } from '../../schemas'

interface SitemapProfile {
  competitor: string
  fact: string
  totalUrls: number
  sections: { section: string; count: number; examples: string[] }[]
}

interface SerpCompetitorFact {
  competitor: string
  query: string
  market: string
  position: number
  url: string
}

/**
 * Two competitor gaps, from evidence already collected.
 *
 * The SERP adapter has been recording competitor positions since the first
 * run, and nothing consumed them — the engine could tell you a rival ranked
 * #4 and never turned that into a decision. These detectors do.
 */

/**
 * Structural gap: a section of their site that has no equivalent on ours.
 *
 * This is the finding that changes a roadmap rather than a page. "They have 45
 * URLs under /tools and we have none" is a decision about what to build; a
 * per-keyword position is not.
 */
export const competitorContentGapDetector: Detector = {
  id: 'competitor-content-gap',
  version: '1.0.0',
  description:
    'Compares competitor sitemap sections against our own crawled paths to find surfaces they have built and we have not.',

  run({ config, evidence, pages }: DetectorInput): OpportunityDraft[] {
    const profiles = evidence
      .filter((e) => e.kind === 'competitor_fact')
      .map((row) => ({ row, v: value<SitemapProfile>(row) }))
      .filter((x) => x.v.fact === 'sitemap_profile')

    if (profiles.length === 0) return []

    // Our own sections, from pages we actually crawled.
    const ourSections = new Set<string>()
    for (const page of pages) {
      try {
        ourSections.add(new URL(page.url).pathname.split('/').filter(Boolean)[0] ?? '(root)')
      } catch {
        /* a page URL we cannot parse tells us nothing about sections */
      }
    }

    // Aggregate by section so a surface built by two competitors reads as one
    // opportunity backed by two sources, not two competing suggestions.
    const bySection = new Map<
      string,
      { competitors: string[]; totalPages: number; examples: string[]; evidenceIds: string[] }
    >()

    for (const { row, v } of profiles) {
      for (const section of v.sections) {
        // Sections that exist on our site are not gaps, and a section with a
        // couple of pages is a page, not a surface.
        if (ourSections.has(section.section) || section.count < 5) continue
        if (section.section === '(root)') continue
        // A locale prefix is not a content surface — it is the same content in
        // another language, which is a localisation finding with a different
        // action attached. Handled by the detector below.
        if (LOCALE_SEGMENT.test(section.section)) continue

        const entry = bySection.get(section.section) ?? {
          competitors: [],
          totalPages: 0,
          examples: [],
          evidenceIds: [],
        }
        entry.competitors.push(v.competitor)
        entry.totalPages += section.count
        entry.examples.push(...section.examples.slice(0, 2))
        entry.evidenceIds.push(row.id)
        bySection.set(section.section, entry)
      }
    }

    return [...bySection.entries()].map(([section, entry]) => ({
      type: 'competitor' as const,
      detectorId: competitorContentGapDetector.id,
      detectorVersion: competitorContentGapDetector.version,
      title:
        `No /${section} surface — ${entry.competitors.length === 1 ? entry.competitors[0] : `${entry.competitors.length} competitors`} ` +
        `publish ${entry.totalPages} pages there`,
      subject: `/${section}`,
      evidenceIds: [...new Set(entry.evidenceIds)],
      isBlocker: false,
      impactInputs: {
        // Scale of their investment stands in for demand: a surface nobody
        // maintains does not accumulate pages.
        demand: Math.min(10, Math.log2(entry.totalPages + 1) * 1.5),
        headroom: 0,
        // More competitors building the same surface is stronger evidence that
        // it is worth having than one competitor doing so.
        coverage: Math.min(1, entry.competitors.length / 2),
        severity: 0,
        citationHeadroom: 0,
        aiOverviewPresent: false,
      },
      intent: 'commercial' as const,
      effortClass: 'data_page' as const,
      weakestTier: 'measured' as const,
      sourceCount: new Set(entry.competitors).size,
      sampleDiscount: 1,
      suggestedAction: {
        kind: 'plan_content_surface',
        title: `Decide whether ${config.name} needs a /${section} surface`,
        spec:
          `${entry.competitors.join(', ')} publish ${entry.totalPages} pages under /${section} and ` +
          `this property has none. Examples: ${entry.examples.slice(0, 3).join(', ')}. ` +
          `This is a roadmap decision rather than a page: decide whether the surface earns its ` +
          `keep here, and if it does, whether each page can carry unique value — a section of ` +
          `near-duplicates is the pattern search engines demote.`,
        criteria: [
          {
            id: 'surface_exists',
            description: `At least one page exists under /${section}`,
            check: `http_status:/${section}/=200`,
          },
        ],
      },
    }))
  },
}

/**
 * Demand gap: topics where competitors rank and we are nowhere.
 *
 * Aggregated per competitor rather than per query, because "they beat us on 12
 * queries" is one decision and twelve rows of the same finding is noise.
 */
export const competitorSerpGapDetector: Detector = {
  id: 'competitor-serp-dominance',
  version: '1.0.0',
  description:
    'Aggregates queries where a competitor ranks and the property does not appear at all.',

  run({ config, evidence }: DetectorInput): OpportunityDraft[] {
    const serpRows = evidence.filter((e) => e.kind === 'serp_observation')
    const competitorRows = evidence
      .filter((e) => e.kind === 'competitor_fact')
      .map((row) => ({ row, v: value<SerpCompetitorFact>(row) }))
      .filter((x) => x.v.query)

    if (competitorRows.length === 0) return []

    // Queries where we are absent, so "they rank and we do not" is measured
    // rather than assumed.
    const weAreAbsent = new Set(
      serpRows
        .map((r) => value<{ query: string; ownPosition: number | null }>(r))
        .filter((v) => v.ownPosition === null)
        .map((v) => v.query),
    )

    const byCompetitor = new Map<
      string,
      { queries: { query: string; position: number }[]; evidenceIds: string[] }
    >()

    for (const { row, v } of competitorRows) {
      if (!weAreAbsent.has(v.query)) continue
      const entry = byCompetitor.get(v.competitor) ?? { queries: [], evidenceIds: [] }
      if (!entry.queries.some((q) => q.query === v.query)) {
        entry.queries.push({ query: v.query, position: v.position })
      }
      entry.evidenceIds.push(row.id)
      byCompetitor.set(v.competitor, entry)
    }

    return [...byCompetitor.entries()]
      .filter(([, entry]) => entry.queries.length >= 3)
      .map(([competitor, entry]) => {
        const top = [...entry.queries].sort((a, b) => a.position - b.position)
        return {
          type: 'competitor' as const,
          detectorId: competitorSerpGapDetector.id,
          detectorVersion: competitorSerpGapDetector.version,
          title: `${competitor} ranks on ${entry.queries.length} tracked queries where we are absent`,
          subject: competitor,
          evidenceIds: [...new Set(entry.evidenceIds)],
          isBlocker: false,
          impactInputs: {
            demand: Math.min(10, entry.queries.length),
            // How much of their advantage is reachable: positions we could
            // realistically contest rather than the whole gap.
            headroom: Math.min(1, top.filter((q) => q.position > 3).length / entry.queries.length),
            coverage: 0,
            severity: 0,
            citationHeadroom: 0,
            aiOverviewPresent: false,
          },
          intent: 'commercial' as const,
          effortClass: 'new_page' as const,
          weakestTier: 'measured' as const,
          sourceCount: 1,
          sampleDiscount: 1,
          suggestedAction: {
            kind: 'publish_comparison_page',
            title: `Publish a comparison covering ${competitor}`,
            spec:
              `${competitor} appears for ${entry.queries.length} tracked queries where ${config.name} ` +
              `does not rank at all, strongest at #${top[0].position} for "${top[0].query}". ` +
              `An honest comparison page is the surface that competes for these queries directly, ` +
              `and it is the page type answer engines cite most for commercial intent.`,
            criteria: [
              {
                id: 'comparison_live',
                description: 'Comparison page returns 200 and is indexable',
                check: 'page_indexable',
              },
              {
                id: 'answer_block',
                description: 'Opens with a question heading and a direct answer',
                check: 'answer_block_present',
              },
              {
                id: 'competitive_progress',
                description: `Enters top 10 for "${top[0].query}" within the measurement window`,
                check: `rank_within:${top[0].query}=10`,
              },
            ],
          },
        }
      })
  },
}

/**
 * Locale prefixes in a competitor's sitemap, read against the markets this
 * property says it serves.
 *
 * Grouping these with content gaps would be wrong twice over: a locale is the
 * same content translated rather than a new surface, and the finding only
 * matters when the property has actually committed to that market. Config is
 * what makes it a gap — a competitor publishing Japanese pages is irrelevant
 * unless we sell in Japan.
 */
const LOCALE_SEGMENT = /^[a-z]{2}(-[a-z]{2})?$/i

export const localisationGapDetector: Detector = {
  id: 'localisation-gap',
  version: '1.0.0',
  description:
    'Finds configured markets where competitors publish localised pages and this property does not.',

  run({ config, evidence, pages }: DetectorInput): OpportunityDraft[] {
    const profiles = evidence
      .filter((e) => e.kind === 'competitor_fact')
      .map((row) => ({ row, v: value<SitemapProfile>(row) }))
      .filter((x) => x.v.fact === 'sitemap_profile')

    if (profiles.length === 0) return []

    // Languages this property has committed to serving, minus English, which
    // is the default rather than a localisation decision.
    const targetLanguages = [...new Set(config.markets.map((m) => m.language.toLowerCase()))].filter(
      (l) => l !== 'en',
    )
    if (targetLanguages.length === 0) return []

    // Do we publish anything under those locales ourselves?
    const ourLocales = new Set<string>()
    for (const page of pages) {
      try {
        const segment = new URL(page.url).pathname.split('/').filter(Boolean)[0] ?? ''
        if (LOCALE_SEGMENT.test(segment)) ourLocales.add(segment.slice(0, 2).toLowerCase())
      } catch {
        /* unparseable page URLs tell us nothing about locales */
      }
    }

    const drafts: OpportunityDraft[] = []

    for (const language of targetLanguages) {
      if (ourLocales.has(language)) continue

      const rivals = profiles
        .map(({ row, v }) => {
          const match = v.sections.find(
            (s) => LOCALE_SEGMENT.test(s.section) && s.section.slice(0, 2).toLowerCase() === language,
          )
          return match ? { competitor: v.competitor, count: match.count, evidenceId: row.id } : null
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)

      if (rivals.length === 0) continue

      const markets = config.markets.filter((m) => m.language.toLowerCase() === language)
      const total = rivals.reduce((sum, r) => sum + r.count, 0)

      drafts.push({
        type: 'competitor',
        detectorId: localisationGapDetector.id,
        detectorVersion: localisationGapDetector.version,
        title:
          `No ${language.toUpperCase()} content, but ${markets.map((m) => m.market.toUpperCase()).join('/')} ` +
          `is a configured market and competitors publish ${total} localised pages`,
        subject: language,
        evidenceIds: rivals.map((r) => r.evidenceId),
        isBlocker: false,
        impactInputs: {
          // Every query cluster in that market is served by nothing today, so
          // the gap covers the whole market rather than a page of it.
          demand: Math.min(10, Math.log2(total + 1) * 1.5),
          headroom: 1,
          coverage: 1,
          severity: 0,
          citationHeadroom: 0,
          aiOverviewPresent: false,
        },
        intent: 'commercial',
        effortClass: 'data_page',
        weakestTier: 'measured',
        sourceCount: rivals.length,
        sampleDiscount: 1,
        suggestedAction: {
          kind: 'plan_localisation',
          title: `Serve ${markets.map((m) => m.market.toUpperCase()).join('/')} in ${language.toUpperCase()}`,
          spec:
            `This property targets ${markets.map((m) => `${m.market}/${m.language}`).join(', ')} but publishes ` +
            `nothing in ${language.toUpperCase()}. ` +
            rivals.map((r) => `${r.competitor} has ${r.count} pages`).join(', ') +
            `. Localisation is a config-level decision here: the same asset templates render per ` +
            `market, so the work is translation and hreflang, not a new content programme. ` +
            `Machine translation without review is the failure mode — thin localised duplicates ` +
            `are treated as scaled content abuse.`,
          criteria: [
            {
              id: 'locale_pages_exist',
              description: `At least one page exists under /${language}`,
              check: `http_status:/${language}/=200`,
            },
            {
              id: 'hreflang_declared',
              description: 'Homepage declares an hreflang alternate for the locale',
              check: `body_contains:/=hreflang="${language}`,
            },
          ],
        },
      })
    }

    return drafts
  },
}
