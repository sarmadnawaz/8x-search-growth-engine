/**
 * Seeds a database by running the real pipeline in replay mode.
 *
 * Deliberately not a fixtures file of hand-written rows: the seed is produced
 * by the same code path a live run uses, replaying recorded API responses. So
 * the demo data cannot drift from what the engine actually produces, and a
 * detector change shows up here immediately instead of being masked by
 * hand-maintained rows.
 *
 * This replaces committing a binary database file — that was opaque in review
 * and tied the repo to one database engine.
 */
import { loadEnv } from '../lib/env'

loadEnv()

async function main() {
  const { collect } = await import('../lib/engine/pipeline')
  const { detect } = await import('../lib/engine/detectors')
  const { make, apply } = await import('../lib/engine/make')
  const { verifyActions } = await import('../lib/engine/verify')
  const { listPropertyDomains } = await import('../lib/engine/config')
  const { prisma } = await import('../lib/db')

  const domains = listPropertyDomains()

  // A seed must produce the same result whatever was there before, so it owns
  // its tables outright. Cascades from Property clear snapshots, evidence,
  // opportunities and actions; Run has no parent so it is cleared explicitly.
  await prisma.run.deleteMany()
  await prisma.property.deleteMany()

  console.log(`seeding ${domains.length} properties from recorded fixtures`)

  for (const domain of domains) {
    // Two snapshots per property: a single run is a baseline, and the
    // dashboard's "what changed" panel needs something to diff against.
    for (let run = 1; run <= 2; run++) {
      const summary = await collect({ domain, mode: 'replay', log: () => {} })
      await detect(summary.snapshotId)
      await make(summary.snapshotId)

      // Only the property we control gets its fixes applied and verified —
      // the same rule the engine enforces at runtime.
      if (run === 1) await apply(domain)
    }
    await verifyActions(domain)

    const [opportunities, actions, verified, proposed] = await Promise.all([
      prisma.opportunity.count({ where: { domain } }),
      prisma.action.count({ where: { domain } }),
      prisma.action.count({ where: { domain, status: 'verified' } }),
      prisma.action.count({ where: { domain, status: 'proposed' } }),
    ])
    console.log(
      `  ${domain}: ${opportunities} opportunities, ${actions} actions ` +
        `(${verified} verified` +
        (proposed > 0 ? `, ${proposed} proposed — no deploy access)` : ')'),
    )
  }

  console.log('seed complete')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .then(() => process.exit(0))
