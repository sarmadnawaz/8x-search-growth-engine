/**
 * Seeds a database by running the real pipeline in replay mode.
 *
 * Deliberately not a fixtures file of hand-written rows: the seed is produced
 * by the same code path a live run uses, replaying recorded API responses. So
 * the demo data cannot drift from what the engine actually produces, and a
 * detector change shows up here immediately instead of being masked by
 * hand-maintained rows. It also replaces committing a binary database file,
 * which was opaque in review and tied the repo to one database engine.
 *
 * ON THE TIMELINE: this engine has not been running for a month, so snapshot
 * timestamps are backdated to a weekly cadence to show what a month of
 * operation looks like. The evidence inside every snapshot is real — real
 * crawls, real recorded SERP responses — and on the property we control the
 * data genuinely changes between runs, because generated fixes are applied
 * midway and the later crawls observe the result. Only the clock is synthetic,
 * and the dashboard labels it as seeded.
 */
import { loadEnv } from '../lib/env'

loadEnv()

const WEEK = 7 * 24 * 60 * 60 * 1000
/** Three weeks of history plus today. */
const RUN_OFFSETS = [3 * WEEK, 2 * WEEK, WEEK, 0]
/** Fixes ship after this run, so later snapshots observe a real change. */
const SHIP_AFTER_RUN = 1

async function main() {
  const { collect } = await import('../lib/engine/pipeline')
  const { detect } = await import('../lib/engine/detectors')
  const { make, apply } = await import('../lib/engine/make')
  const { verifyActions } = await import('../lib/engine/verify')
  const { listPropertyDomains, loadProperty } = await import('../lib/engine/config')
  const { prisma } = await import('../lib/db')

  const domains = listPropertyDomains()

  // A seed must produce the same result whatever was there before, so it owns
  // its tables outright. Cascades from Property clear snapshots, evidence,
  // opportunities and actions; Run has no parent so it is cleared explicitly.
  await prisma.run.deleteMany()
  await prisma.property.deleteMany()

  console.log(`seeding ${domains.length} properties · ${RUN_OFFSETS.length} runs each`)

  for (const domain of domains) {
    const config = loadProperty(domain)

    for (const [index, offset] of RUN_OFFSETS.entries()) {
      const at = new Date(Date.now() - offset)

      const summary = await collect({ domain, mode: 'replay', log: () => {} })
      await detect(summary.snapshotId)
      await make(summary.snapshotId)

      // Backdating happens after collection rather than by faking a clock, so
      // nothing inside the engine has to know the seed exists.
      await prisma.snapshot.update({
        where: { id: summary.snapshotId },
        data: { startedAt: at, finishedAt: at },
      })
      await prisma.page.updateMany({
        where: { snapshotId: summary.snapshotId },
        data: { fetchedAt: at },
      })
      await prisma.evidence.updateMany({
        where: { snapshotId: summary.snapshotId },
        data: { fetchedAt: at },
      })

      // On the property we control, generated fixes ship midway — so the last
      // two snapshots observe genuinely different data and the trend reflects
      // work rather than noise.
      if (config.deployAccess && index === SHIP_AFTER_RUN) {
        await apply(domain)
        const shippedAt = new Date(Date.now() - RUN_OFFSETS[SHIP_AFTER_RUN])
        await prisma.action.updateMany({
          where: { domain, status: 'executed' },
          data: { createdAt: shippedAt },
        })
      }
    }

    // Verify last, so outcome windows measure against the backdated ship date
    // and can return something other than "too early".
    await verifyActions(domain)

    const [opportunities, actions, verified, proposed, measurements] = await Promise.all([
      prisma.opportunity.count({ where: { domain } }),
      prisma.action.count({ where: { domain } }),
      prisma.action.count({ where: { domain, status: 'verified' } }),
      prisma.action.count({ where: { domain, status: 'proposed' } }),
      prisma.measurement.count({ where: { domain } }),
    ])
    console.log(
      `  ${domain}: ${opportunities} opportunities, ${actions} actions ` +
        `(${verified} verified${proposed > 0 ? `, ${proposed} proposed — no deploy access` : ''}), ` +
        `${measurements} measurements`,
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
