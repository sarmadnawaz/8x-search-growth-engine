import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient
  prismaPragmasApplied?: boolean
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ log: process.env.PRISMA_LOG ? ['query', 'warn', 'error'] : ['warn', 'error'] })

/**
 * SQLite defaults to rollback-journal mode, where a long-lived reader can hold
 * a stale view of the file. That bites here specifically: the dashboard is a
 * long-running process and the pipeline is a separate one, so running a
 * pipeline with the dashboard open showed the previous snapshot's numbers
 * until the server was restarted.
 *
 * WAL lets readers see other processes' commits; busy_timeout stops a
 * concurrent write from failing outright while another connection holds the
 * lock. Both are the standard settings for a SQLite file shared by more than
 * one process — and both stop mattering when this moves to Postgres.
 */
if (!globalForPrisma.prismaPragmasApplied) {
  globalForPrisma.prismaPragmasApplied = true
  void prisma
    .$executeRawUnsafe('PRAGMA journal_mode=WAL;')
    .then(() => prisma.$executeRawUnsafe('PRAGMA busy_timeout=5000;'))
    .catch((err: unknown) => {
      console.warn('could not apply SQLite pragmas:', err)
    })
}

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
