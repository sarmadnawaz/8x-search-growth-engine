import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getProperty } from '@/lib/engine/queries'
import { TrendChart } from '@/app/components/TrendChart'
import { EvidenceDrawer } from '@/app/components/EvidenceDrawer'
import { ActionCard } from '@/app/components/ActionCard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export const dynamic = 'force-dynamic'

export default async function PropertyPage({ params }: { params: Promise<{ domain: string }> }) {
  const { domain } = await params
  const data = await getProperty(decodeURIComponent(domain))
  if (!data) notFound()

  const {
    property,
    config,
    latest,
    opportunities,
    opportunityTotal,
    actions,
    actionTotal,
    evidenceById,
    clusters,
    evidenceCount,
    pageCount,
    indexablePages,
    changes,
    series,
  } = data
  const degraded = latest ? ((latest.degradedAdapters as string[] | null) ?? []) : []
  const deployAccess = Boolean((config as { deployAccess?: boolean }).deployAccess)
  const markets = ((config as { markets?: unknown[] }).markets ?? []).length

  const loop = [
    { k: '1 · Input', v: `${markets} market${markets === 1 ? '' : 's'}`, d: 'from config' },
    {
      k: '2 · Inspect',
      v: `${pageCount} pages`,
      d: `${indexablePages} indexable`,
    },
    { k: '3 · Compare', v: `${clusters.length} clusters`, d: `${evidenceCount} evidence rows` },
    {
      k: '4 · Rank',
      v: `${opportunityTotal} opportunities`,
      d: `${opportunities.filter((o) => o.isBlocker).length} blockers`,
    },
    {
      k: '5 · Make',
      v: `${actionTotal} actions`,
      d: `${actions.filter((a) => a.assets.length > 0).length} with assets`,
    },
    {
      k: '6 · Measure',
      v: `${actions.filter((a) => a.status === 'verified').length} verified`,
      d: 'by re-check',
    },
  ]

  return (
    <main className="space-y-6">
      <header>
        <Link href="/" className="text-muted-foreground hover:text-foreground text-xs">
          ← portfolio
        </Link>
        <p className="border-brand-rule text-brand-accent mt-3 border-b pb-1.5 text-[10px] font-bold tracking-[0.14em] uppercase">
          Property
        </p>
        <h1 className="text-brand-ink mt-3 text-xl font-bold">{property.domain}</h1>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge variant="secondary">{property.name}</Badge>
          <Badge variant="outline">goal: {property.goal}</Badge>
          <Badge variant="outline">{property.publishingPolicy}</Badge>
          <Badge variant={deployAccess ? 'default' : 'outline'}>
            {deployAccess ? 'deploy access' : 'no deploy access, fixes stay proposed'}
          </Badge>
        </div>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Latest run</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {loop.map((s) => (
              <div key={s.k} className="border-primary/40 rounded-md border border-l-2 p-2.5">
                <p className="text-muted-foreground text-[10px] tracking-wide uppercase">{s.k}</p>
                <p className="mt-0.5 text-sm font-medium">{s.v}</p>
                <p className="text-muted-foreground text-xs">{s.d}</p>
              </div>
            ))}
          </div>
          {degraded.length > 0 && (
            <p className="text-muted-foreground mt-3 text-xs">
              <span className="text-foreground font-medium">Degraded this run:</span>{' '}
              {degraded.join(', ')}. Those evidence families are absent rather than guessed.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[7fr_5fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">
                Target list. Every row carries its evidence
              </CardTitle>
            </CardHeader>
            <CardContent>
              {opportunities.length === 0 ? (
                <p className="text-muted-foreground text-sm">No opportunities in this snapshot.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Finding</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Score breakdown</TableHead>
                      <TableHead className="text-right">Prio</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {opportunities.map((o) => (
                      <TableRow key={o.id} className="align-top">
                        <TableCell className="max-w-[280px] py-3">
                          <p className="text-sm font-medium whitespace-normal">{o.title}</p>
                          <EvidenceDrawer
                            evidence={(o.evidenceIds as string[])
                              .map((id) => evidenceById.get(id))
                              .filter((e) => e !== undefined)}
                          />
                        </TableCell>
                        <TableCell className="py-3">
                          <Badge variant="outline" className="text-[10px]">
                            {o.type}
                          </Badge>
                          {o.isBlocker && (
                            <Badge variant="destructive" className="mt-1 block text-[10px]">
                              blocker
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground py-3 font-mono text-[11px] tabular-nums">
                          {o.impact.toFixed(2)} × {o.confidence.toFixed(2)} × {o.fit.toFixed(1)} ÷{' '}
                          {o.effort} ={' '}
                          <span className="text-foreground font-medium">
                            {o.rawScore.toFixed(2)}
                          </span>
                        </TableCell>
                        <TableCell className="py-3 text-right text-sm font-semibold tabular-nums">
                          {o.priority}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {opportunityTotal > opportunities.length && (
                <p className="text-muted-foreground mt-3 text-xs">
                  Showing the top {opportunities.length} of {opportunityTotal} by priority.
                </p>
              )}
              <p className="text-muted-foreground mt-3 text-xs">
                Priority is a mapping, not a measurement: blockers take 90 to 100 by coverage,
                everything else normalises into 20 to 89 within this snapshot. The factors are stored,
                so the arithmetic can be redone by hand.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">
                Actions. Status is set by re-check, never by assertion
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {actions.length === 0 ? (
                <p className="text-muted-foreground text-sm">No actions yet.</p>
              ) : (
                actions.map((a) => (
                  <ActionCard key={a.id} action={a} deployAccess={deployAccess} />
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Evolution over time</CardTitle>
            </CardHeader>
            <CardContent>
              <TrendChart
                data={series.map((point, i) => ({
                  at: point.at.toISOString().slice(5, 10),
                  indexablePages: point.indexablePages,
                  shipped: i > 0 && point.indexablePages > (series[i - 1]?.indexablePages ?? 0),
                }))}
              />
              {series.length > 1 && (
                <p className="text-muted-foreground mt-3 text-xs">
                  Indexable pages, because it moves on a timescale this can honestly show. Ranking
                  outcomes are measured over 2 to 6 month windows by the measure stage. The ringed
                  point is the run where the engine shipped its own work.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">
                What changed since the previous snapshot
              </CardTitle>
            </CardHeader>
            <CardContent>
              {changes.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Nothing changed between the last two snapshots, or there is only one.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {changes.map((c) => (
                    <li key={c} className="text-muted-foreground border-b pb-1.5 text-xs last:border-0">
                      {c}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {clusters.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Demand clusters</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableBody>
                    {clusters.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="py-1.5 text-xs">{c.query}</TableCell>
                        <TableCell className="text-muted-foreground py-1.5 text-xs">
                          {c.market}
                        </TableCell>
                        <TableCell className="py-1.5">
                          <Badge
                            variant={c.demandSource === 'measured' ? 'default' : 'outline'}
                            className="text-[10px]"
                          >
                            {c.demandSource}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-1.5 text-right text-xs tabular-nums">
                          {c.demand.toFixed(1)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Why this scales to the next domain</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-xs">
                Everything on this page came from{' '}
                <code className="bg-muted rounded px-1 py-0.5">
                  properties/{property.domain}.yaml
                </code>{' '}
                plus the shared engine. No code in{' '}
                <code className="bg-muted rounded px-1 py-0.5">lib/engine/</code> mentions this
                domain. Run{' '}
                <code className="bg-muted rounded px-1 py-0.5">npm run check:onboarding</code> fails
                if that stops being true.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  )
}
