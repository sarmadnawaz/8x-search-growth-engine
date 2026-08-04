import { prisma } from '../db'

/**
 * Read models for the dashboard.
 *
 * The rule the UI enforces: every number on screen can be traced to the
 * evidence rows that produced it.
 *
 * The rule these queries enforce: cost must not grow with the size of the
 * portfolio. An earlier version fanned out per property and then per snapshot
 * — about twelve queries per property, so six thousand for a 500-property
 * portfolio, all issued at once against a connection pool of nine. That does
 * not degrade gracefully; it exhausts the pool and the page throws. Everything
 * below is aggregate-first: a fixed number of queries however many properties
 * exist.
 */

const SPARKLINE_POINTS = 8

/** How many opportunities and actions the property view renders before paging. */
export const PAGE_SIZE = 25

export async function getPortfolio() {
  const properties = await prisma.property.findMany({ orderBy: { domain: 'asc' } })
  if (properties.length === 0) return []

  const domains = properties.map((p) => p.domain)

  // One query for the snapshot series across every property. The page counts
  // ride along on the snapshot row rather than being counted per snapshot.
  const snapshots = await prisma.snapshot.findMany({
    where: { domain: { in: domains }, status: { not: 'pending' } },
    orderBy: { startedAt: 'desc' },
    select: { id: true, domain: true, startedAt: true, status: true, indexablePages: true },
  })

  const byDomain = new Map<string, typeof snapshots>()
  for (const snapshot of snapshots) {
    const list = byDomain.get(snapshot.domain) ?? []
    if (list.length < SPARKLINE_POINTS) list.push(snapshot)
    byDomain.set(snapshot.domain, list)
  }

  const latestIds = [...byDomain.values()]
    .map((list) => list[0]?.id)
    .filter((id): id is string => Boolean(id))

  // Two aggregates, instead of two queries per property.
  const [opportunityCounts, actionCounts] = await Promise.all([
    prisma.opportunity.groupBy({
      by: ['domain'],
      where: { snapshotId: { in: latestIds } },
      _count: { _all: true },
    }),
    prisma.action.groupBy({
      by: ['domain', 'status'],
      where: { domain: { in: domains } },
      _count: { _all: true },
    }),
  ])

  const opportunitiesFor = new Map(opportunityCounts.map((row) => [row.domain, row._count._all]))
  const actionsFor = new Map<string, { total: number; verified: number }>()
  for (const row of actionCounts) {
    const entry = actionsFor.get(row.domain) ?? { total: 0, verified: 0 }
    entry.total += row._count._all
    if (row.status === 'verified') entry.verified += row._count._all
    actionsFor.set(row.domain, entry)
  }

  return properties.map((property) => {
    const series = [...(byDomain.get(property.domain) ?? [])].reverse()
    const latest = series.at(-1) ?? null
    const actions = actionsFor.get(property.domain) ?? { total: 0, verified: 0 }

    return {
      domain: property.domain,
      name: property.name,
      latestSnapshot: latest,
      snapshotCount: series.length,
      openOpportunities: opportunitiesFor.get(property.domain) ?? 0,
      indexablePages: latest?.indexablePages ?? 0,
      actionsVerified: actions.verified,
      actionsTotal: actions.total,
      series: series.map((s) => ({ at: s.startedAt, indexablePages: s.indexablePages })),
    }
  })
}

export async function getProperty(domain: string, limit = PAGE_SIZE) {
  const property = await prisma.property.findUnique({ where: { domain } })
  if (!property) return null

  const snapshots = await prisma.snapshot.findMany({
    where: { domain, status: { not: 'pending' } },
    orderBy: { startedAt: 'desc' },
    take: SPARKLINE_POINTS,
  })
  const latest = snapshots[0]
  const previous = snapshots[1]

  const [opportunities, opportunityTotal, actions, actionTotal, evidenceCount, clusters] =
    await Promise.all([
      latest
        ? prisma.opportunity.findMany({
            where: { snapshotId: latest.id },
            orderBy: { priority: 'desc' },
            take: limit,
          })
        : [],
      latest ? prisma.opportunity.count({ where: { snapshotId: latest.id } }) : 0,
      // `select` rather than the whole row: criteria and lastCheck hold a
      // paragraph of observations each. Pulling every column to render a list
      // was megabytes per request.
      prisma.action.findMany({
        where: { domain },
        orderBy: { createdAt: 'asc' },
        take: limit,
        select: {
          id: true,
          kind: true,
          subject: true,
          title: true,
          spec: true,
          status: true,
          verifiedAt: true,
          criteria: true,
          lastCheck: true,
          assets: {
            select: { id: true, type: true, path: true, reviewState: true, body: true },
          },
        },
      }),
      prisma.action.count({ where: { domain } }),
      latest ? prisma.evidence.count({ where: { snapshotId: latest.id } }) : 0,
      prisma.queryCluster.findMany({ where: { domain }, orderBy: { demand: 'desc' }, take: 10 }),
    ])

  // Evidence for every rendered opportunity in one query, rather than two per
  // row from inside the component tree.
  const evidenceIds = opportunities.flatMap((o) => o.evidenceIds as string[])
  const evidenceRows = evidenceIds.length
    ? await prisma.evidence.findMany({ where: { id: { in: [...new Set(evidenceIds)] } } })
    : []
  const evidenceById = new Map(evidenceRows.map((row) => [row.id, row]))

  // "What changed" is a diff between two snapshots, not a stored narrative.
  const changes: string[] = []
  if (latest && previous) {
    const previousOpportunities = await prisma.opportunity.findMany({
      where: { snapshotId: previous.id },
      select: { title: true },
    })
    const previousTitles = new Set(previousOpportunities.map((o) => o.title))
    const currentTitles = new Set(opportunities.map((o) => o.title))

    for (const title of currentTitles) if (!previousTitles.has(title)) changes.push(`new: ${title}`)
    for (const title of previousTitles) {
      if (!currentTitles.has(title)) changes.push(`resolved: ${title}`)
    }
    if (latest.indexablePages !== previous.indexablePages) {
      changes.push(`indexable pages ${previous.indexablePages} → ${latest.indexablePages}`)
    }
  }

  return {
    property,
    config: property.config as Record<string, unknown>,
    latest,
    snapshots,
    opportunities,
    opportunityTotal,
    actions,
    actionTotal,
    evidenceById,
    clusters,
    evidenceCount,
    pageCount: latest?.totalPages ?? 0,
    indexablePages: latest?.indexablePages ?? 0,
    changes,
    series: [...snapshots]
      .reverse()
      .map((s) => ({ at: s.startedAt, indexablePages: s.indexablePages })),
  }
}
