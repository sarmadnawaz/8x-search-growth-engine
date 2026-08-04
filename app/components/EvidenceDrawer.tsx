import type { Evidence } from '@prisma/client'
import { Badge } from '@/components/ui/badge'

/**
 * The click-through from a recommendation to the raw datum behind it.
 *
 * This is the thesis of the system in UI form: a reviewer never has to take a
 * recommendation on trust. Source, confidence tier, fetch time and the raw
 * payload are one click away.
 *
 * Evidence is passed in rather than fetched here. Querying per row meant two
 * extra round trips for every opportunity rendered — eighty on a page showing
 * forty — and server components make that invisible until you count them.
 */
export function EvidenceDrawer({ evidence }: { evidence: Evidence[] }) {
  if (evidence.length === 0) return null

  return (
    <details className="group mt-1">
      <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-xs">
        {evidence.length} evidence row{evidence.length === 1 ? '' : 's'}
      </summary>
      <div className="mt-2 space-y-2">
        {evidence.map((e) => (
          <div key={e.id} className="bg-muted/50 rounded-md border p-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="text-[10px]">
                {e.kind}
              </Badge>
              <Badge variant="secondary" className="text-[10px]">
                {e.source}
              </Badge>
              <Badge variant={e.tier === 'measured' ? 'default' : 'outline'} className="text-[10px]">
                {e.tier}
              </Badge>
              <span className="text-muted-foreground text-[10px]">
                {e.fetchedAt.toISOString().slice(0, 16).replace('T', ' ')}
              </span>
            </div>
            <p className="text-muted-foreground mt-1.5 text-[11px] break-all">{e.subject}</p>
            <pre className="text-muted-foreground mt-2 max-h-40 overflow-auto text-[10px] whitespace-pre-wrap">
              {JSON.stringify(e.value, null, 2).slice(0, 2000)}
            </pre>
          </div>
        ))}
      </div>
    </details>
  )
}
