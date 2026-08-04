import type { Action, Asset, Opportunity } from '@prisma/client'
import { Badge } from '@/components/ui/badge'

type ActionWithRelations = Action & { assets: Asset[]; opportunity: Opportunity }

interface CriterionResult {
  id: string
  description: string
  check: string
  passed?: boolean
  observed?: string
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  verified: 'default',
  executed: 'secondary',
  approved: 'secondary',
  proposed: 'outline',
  failed: 'destructive',
  stopped: 'outline',
}

/**
 * An action, its acceptance criteria, and what the last check actually observed.
 *
 * The observed value is shown even when a criterion fails: a reviewer should
 * see "canonical_missing still present" rather than an unexplained red mark,
 * and should be able to reproduce it with curl.
 */
export function ActionCard({
  action,
  deployAccess,
}: {
  action: ActionWithRelations
  deployAccess: boolean
}) {
  const criteria = action.criteria as unknown as CriterionResult[]
  const lastCheck = (action.lastCheck as unknown as CriterionResult[] | null) ?? null
  const results = lastCheck ?? criteria
  const passed = results.filter((c) => c.passed).length

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium">{action.title}</p>
        <Badge variant={STATUS_VARIANT[action.status] ?? 'outline'} className="shrink-0">
          {action.status}
        </Badge>
      </div>

      {!deployAccess && action.status === 'proposed' && (
        <p className="text-muted-foreground mt-1.5 text-xs">
          We do not control deploys for this property, so this cannot honestly progress past
          proposed. The generated artifact is attached for a human to ship.
        </p>
      )}

      <p className="text-muted-foreground mt-2 text-xs">{action.spec}</p>

      <ul className="mt-3 space-y-1">
        {results.map((c) => (
          <li key={c.id} className="text-muted-foreground flex gap-2 text-xs">
            <span className={c.passed ? 'text-foreground font-bold' : 'text-muted-foreground'}>
              {c.passed ? '✓' : '○'}
            </span>
            <span>
              {c.description}
              {c.observed && <span className="opacity-70"> — observed: {c.observed}</span>}
            </span>
          </li>
        ))}
      </ul>

      {lastCheck && (
        <p className="text-muted-foreground mt-2 text-[11px]">
          {passed}/{results.length} criteria passing on the last re-check
        </p>
      )}

      {action.assets.map((asset) => (
        <details key={asset.id} className="mt-3">
          <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-xs">
            generated {asset.type}
            {asset.path ? ` · ${asset.path}` : ''} · {asset.reviewState}
          </summary>
          <pre className="bg-muted/50 text-muted-foreground mt-2 max-h-56 overflow-auto rounded-md p-3 text-[10px] whitespace-pre-wrap">
            {asset.body}
          </pre>
        </details>
      ))}
    </div>
  )
}
