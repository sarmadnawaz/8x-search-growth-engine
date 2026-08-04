import { prisma } from '../db'

/**
 * Read models for the dashboard.
 *
 * The rule the UI enforces: every number on screen can be traced to the
 * evidence rows that produced it. These queries always carry evidence along
 * with the conclusions drawn from it.
 */

export async function getPortfolio() {
  const properties = await prisma.property.findMany({ orderBy: { domain: 'asc' } })

  return Promise.all(
    properties.map(async (property) => {
      const snapshots = await prisma.snapshot.findMany({
        where: { domain: property.domain, status: { not: 'pending' } },
        orderBy: { startedAt: 'desc' },
        take: 8,
      })
      const latest = snapshots[0]

      const [openOpportunities, actions, indexablePages] = await Promise.all([
        latest ? prisma.opportunity.count({ where: { snapshotId: latest.id } }) : 0,
        prisma.action.findMany({ where: { domain: property.domain } }),
        latest ? prisma.page.count({ where: { snapshotId: latest.id, indexable: true } }) : 0,
      ])

      // Trend series: pages the crawler could see per snapshot. Chosen because
      // it moves on a timescale a demo can honestly show — rankings take
      // months, and a chart that pretends otherwise would be fiction.
      const series = await Promise.all(
        [...snapshots].reverse().map(async (s) => ({
          at: s.startedAt,
          indexablePages: await prisma.page.count({ where: { snapshotId: s.id, indexable: true } }),
        })),
      )

      return {
        domain: property.domain,
        name: property.name,
        latestSnapshot: latest ?? null,
        snapshotCount: snapshots.length,
        openOpportunities,
        indexablePages,
        actionsVerified: actions.filter((a) => a.status === 'verified').length,
        actionsTotal: actions.length,
        series,
      }
    }),
  )
}

export async function getProperty(domain: string) {
  const property = await prisma.property.findUnique({ where: { domain } })
  if (!property) return null

  const snapshots = await prisma.snapshot.findMany({
    where: { domain, status: { not: 'pending' } },
    orderBy: { startedAt: 'desc' },
    take: 8,
  })
  const latest = snapshots[0]
  const previous = snapshots[1]

  const [opportunities, actions, pages, evidenceCount, clusters] = await Promise.all([
    latest
      ? prisma.opportunity.findMany({ where: { snapshotId: latest.id }, orderBy: { priority: 'desc' } })
      : [],
    prisma.action.findMany({
      where: { domain },
      include: { assets: true, opportunity: true },
      orderBy: { createdAt: 'asc' },
    }),
    latest ? prisma.page.findMany({ where: { snapshotId: latest.id } }) : [],
    latest ? prisma.evidence.count({ where: { snapshotId: latest.id } }) : 0,
    prisma.queryCluster.findMany({ where: { domain }, orderBy: { demand: 'desc' }, take: 10 }),
  ])

  // "What changed" is a diff between two snapshots, not a stored narrative.
  let changes: string[] = []
  if (latest && previous) {
    const [previousOpportunities, previousPages] = await Promise.all([
      prisma.opportunity.findMany({ where: { snapshotId: previous.id } }),
      prisma.page.count({ where: { snapshotId: previous.id, indexable: true } }),
    ])
    const nowIndexable = pages.filter((p) => p.indexable).length
    const previousTitles = new Set(previousOpportunities.map((o) => o.title))
    const currentTitles = new Set(opportunities.map((o) => o.title))

    for (const title of currentTitles) {
      if (!previousTitles.has(title)) changes.push(`new: ${title}`)
    }
    for (const title of previousTitles) {
      if (!currentTitles.has(title)) changes.push(`resolved: ${title}`)
    }
    if (nowIndexable !== previousPages) {
      changes.push(`indexable pages ${previousPages} → ${nowIndexable}`)
    }
  }

  const series = await Promise.all(
    [...snapshots].reverse().map(async (s) => ({
      at: s.startedAt,
      indexablePages: await prisma.page.count({ where: { snapshotId: s.id, indexable: true } }),
      opportunities: await prisma.opportunity.count({ where: { snapshotId: s.id } }),
    })),
  )

  return {
    property,
    config: property.config as Record<string, unknown>,
    latest,
    snapshots,
    opportunities,
    actions,
    pages,
    clusters,
    evidenceCount,
    changes,
    series,
  }
}

/** Evidence behind one opportunity — the click-through target from every row. */
export async function getEvidenceFor(opportunityId: string) {
  const opportunity = await prisma.opportunity.findUnique({ where: { id: opportunityId } })
  if (!opportunity) return null
  const ids = opportunity.evidenceIds as string[]
  const evidence = await prisma.evidence.findMany({ where: { id: { in: ids } } })
  return { opportunity, evidence }
}
