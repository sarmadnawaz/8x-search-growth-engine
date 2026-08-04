import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * Liveness plus dependency check.
 *
 * Reports the database separately from the process: a container that is up but
 * cannot reach Postgres should fail its health check rather than serve a
 * dashboard full of empty states that looks like "no opportunities found".
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`
    return NextResponse.json({ status: 'ok', database: 'reachable' })
  } catch (error) {
    return NextResponse.json(
      {
        status: 'degraded',
        database: 'unreachable',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 503 },
    )
  }
}
