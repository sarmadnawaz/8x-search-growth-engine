import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Load .env for CLI entry points.
 *
 * Next.js loads .env itself, so the dashboard always had credentials while the
 * pipeline CLI silently ran without them — every adapter reported "key not
 * set" or hit anonymous rate limits and degraded, which looked like correct
 * behaviour rather than a bug. Entry points call this first.
 */
export function loadEnv(): void {
  const path = join(process.cwd(), '.env')
  if (!existsSync(path)) return
  process.loadEnvFile(path)
}
