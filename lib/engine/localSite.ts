import { createServer, type Server } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
}

/**
 * Serves a directory over real HTTP so the crawler can audit it exactly as it
 * audits a public site — same fetches, same parsing, same evidence.
 *
 * This is what makes the executed -> verified demo honest: we control this
 * site, so a generated fix can actually be applied and the next run's
 * verification genuinely passes or fails on observation.
 */
export async function startLocalSite(dir: string, port: number): Promise<Server> {
  const root = join(process.cwd(), dir)

  const server = createServer((req, res) => {
    const urlPath = (req.url ?? '/').split('?')[0]
    const relative = urlPath.endsWith('/') ? `${urlPath}index.html` : urlPath
    const filePath = join(root, normalize(relative).replace(/^(\.\.[/\\])+/, ''))

    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('Not found')
      return
    }

    res.writeHead(200, { 'content-type': TYPES[extname(filePath)] ?? 'application/octet-stream' })
    res.end(readFileSync(filePath))
  })

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  return server
}
