import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

/**
 * One client per process. Next.js dev reloads modules on edit, so without the
 * global the dev server accumulates connections until Postgres refuses them.
 */
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ log: process.env.PRISMA_LOG ? ['query', 'warn', 'error'] : ['warn', 'error'] })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
