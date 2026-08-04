/**
 * Run the loop for one property.
 *
 *   npm run pipeline -- cherly.app            # live: hits APIs, records fixtures
 *   npm run pipeline -- cherly.app --replay   # offline: replays recorded fixtures
 *   npm run pipeline -- --all
 */
import { collect } from '../lib/engine/pipeline'
import { detect } from '../lib/engine/detectors'
import { listPropertyDomains } from '../lib/engine/config'

async function main() {
  const args = process.argv.slice(2)
  const mode = args.includes('--replay') ? 'replay' : 'live'
  const positional = args.filter((a) => !a.startsWith('--'))
  const domains = args.includes('--all') ? listPropertyDomains() : positional

  if (domains.length === 0) {
    console.error('usage: npm run pipeline -- <domain> [--replay]   (or --all)')
    console.error(`known properties: ${listPropertyDomains().join(', ')}`)
    process.exit(1)
  }

  for (const domain of domains) {
    console.log(`\n=== ${domain} (${mode}) ===`)
    const started = Date.now()
    const summary = await collect({ domain, mode })
    console.log(
      `  snapshot ${summary.snapshotId}: ${summary.pages} pages, ` +
        `${summary.clusters} clusters, ${summary.evidence} evidence rows ` +
        `in ${((Date.now() - started) / 1000).toFixed(1)}s`,
    )
    if (summary.degraded.length > 0) {
      console.log(`  degraded: ${summary.degraded.join('; ')}`)
    }

    const detected = await detect(summary.snapshotId)
    console.log(
      `  ${detected.opportunities} opportunities (${detected.blockers} blocker) — ` +
        Object.entries(detected.byDetector)
          .map(([id, n]) => `${id}: ${n}`)
          .join(', '),
    )
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .then(() => process.exit(0))
