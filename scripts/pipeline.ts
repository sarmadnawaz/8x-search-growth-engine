/**
 * Run the loop for one property.
 *
 *   npm run pipeline -- cherly.app                    # live: hits APIs, records fixtures
 *   npm run pipeline -- cherly.app --replay           # offline: replays recorded fixtures
 *   npm run pipeline -- demo-fixture.local --apply    # also ship generated fixes (owned property only)
 *   npm run pipeline -- --all --replay
 */
import { loadEnv } from '../lib/env'
import { collect } from '../lib/engine/pipeline'
import { detect } from '../lib/engine/detectors'
import { make, apply } from '../lib/engine/make'
import { verifyActions } from '../lib/engine/verify'
import { listPropertyDomains } from '../lib/engine/config'

loadEnv()

async function main() {
  const args = process.argv.slice(2)
  const mode = args.includes('--replay') ? 'replay' : 'live'
  const shouldApply = args.includes('--apply')
  const positional = args.filter((a) => !a.startsWith('--'))
  const domains = args.includes('--all') ? listPropertyDomains() : positional

  if (domains.length === 0) {
    console.error('usage: npm run pipeline -- <domain> [--replay] [--apply]   (or --all)')
    console.error(`known properties: ${listPropertyDomains().join(', ')}`)
    process.exit(1)
  }

  for (const domain of domains) {
    console.log(`\n=== ${domain} (${mode}) ===`)
    const started = Date.now()

    const summary = await collect({ domain, mode })
    console.log(
      `  collect: ${summary.pages} pages, ${summary.clusters} clusters, ` +
        `${summary.evidence} evidence rows`,
    )
    if (summary.degraded.length > 0) console.log(`  degraded: ${summary.degraded.join('; ')}`)

    const detected = await detect(summary.snapshotId)
    console.log(
      `  detect:  ${detected.opportunities} opportunities (${detected.blockers} blocker) — ` +
        Object.entries(detected.byDetector)
          .map(([id, n]) => `${id}: ${n}`)
          .join(', '),
    )

    const made = await make(summary.snapshotId)
    console.log(
      `  make:    ${made.actionsCreated} actions, ${made.assetsGenerated} assets` +
        (made.skippedNoAccess > 0
          ? ` (${made.skippedNoAccess} stay proposed — no deploy access for this property)`
          : ''),
    )

    if (shouldApply) {
      const result = await apply(domain)
      for (const item of result.applied) console.log(`  apply:   shipped ${item}`)
      for (const item of result.refused) console.log(`  apply:   refused ${item}`)
    }

    const verified = await verifyActions(domain)
    if (verified.length > 0) {
      console.log(`  verify:  ${verified.length} action(s) re-checked`)
      for (const result of verified) {
        const passed = result.criteria.filter((c) => c.passed).length
        console.log(`           [${result.status}] ${result.title} — ${passed}/${result.criteria.length} criteria pass`)
        for (const c of result.criteria) {
          console.log(`             ${c.passed ? 'PASS' : 'todo'} ${c.description} (${c.observed})`)
        }
      }
    }

    console.log(`  done in ${((Date.now() - started) / 1000).toFixed(1)}s`)
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .then(() => process.exit(0))
