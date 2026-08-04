import Link from 'next/link'
import { getPortfolio } from '@/lib/engine/queries'
import { listPropertyDomains } from '@/lib/engine/config'
import { Sparkline } from './components/Sparkline'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export const dynamic = 'force-dynamic'

export default async function PortfolioPage() {
  const portfolio = await getPortfolio()
  const configured = listPropertyDomains()
  const notYetRun = configured.filter((d) => !portfolio.some((p) => p.domain === d))

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Search Growth Engine</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {configured.length} configured properties · one pipeline · every number links to the
          evidence that produced it
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {portfolio.map((p) => (
          <Link key={p.domain} href={`/p/${p.domain}`} className="group">
            <Card className="hover:border-foreground/20 h-full transition-colors">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base group-hover:underline">{p.domain}</CardTitle>
                  <Sparkline values={p.series.map((s) => s.indexablePages)} />
                </div>
                <p className="text-muted-foreground text-xs">{p.name}</p>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="secondary">{p.openOpportunities} opportunities</Badge>
                  <Badge variant="outline">{p.indexablePages} indexable</Badge>
                  <Badge variant={p.actionsVerified > 0 ? 'default' : 'outline'}>
                    {p.actionsVerified}/{p.actionsTotal} verified
                  </Badge>
                </div>
                <p className="text-muted-foreground text-xs">
                  {p.snapshotCount} snapshot{p.snapshotCount === 1 ? '' : 's'}
                  {p.latestSnapshot
                    ? ` · last run ${p.latestSnapshot.startedAt.toISOString().slice(0, 16).replace('T', ' ')}`
                    : ''}
                  {p.latestSnapshot?.status === 'partial' ? ' · partial run' : ''}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {notYetRun.length > 0 && (
        <p className="text-muted-foreground text-sm">
          Configured but not yet run: {notYetRun.join(', ')} —{' '}
          <code className="bg-muted rounded px-1.5 py-0.5 text-xs">
            npm run pipeline -- {notYetRun[0]}
          </code>
        </p>
      )}
    </main>
  )
}
