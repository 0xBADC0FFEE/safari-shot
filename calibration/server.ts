import { createServer } from 'node:http'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, extname, normalize } from 'node:path'

const PAGES_DIR = join(import.meta.dirname, 'pages')
const REPORTS_DIR = join(import.meta.dirname, 'out', 'reports')
const DEFAULT_PORT = 8765

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

/**
 * Serves calibration pages and stores reports that pages POST to /report/<name>.
 * @param port TCP port on localhost
 * @returns the listening server
 */
export function startCalibrationServer(port = DEFAULT_PORT) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (req.method === 'POST' && url.pathname.startsWith('/report/')) {
      const name = url.pathname.slice('/report/'.length).replace(/[^\w.-]/g, '_')
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      await mkdir(REPORTS_DIR, { recursive: true })
      await writeFile(join(REPORTS_DIR, `${name}.json`), Buffer.concat(chunks))
      res.writeHead(204).end()
      return
    }
    const path = normalize(url.pathname === '/' ? '/index.html' : url.pathname)
    try {
      const body = await readFile(join(PAGES_DIR, path))
      res.writeHead(200, { 'content-type': CONTENT_TYPES[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
      res.end(body)
    } catch {
      res.writeHead(404).end()
    }
  })
  return new Promise<typeof server>(resolve => server.listen(port, () => resolve(server)))
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? DEFAULT_PORT)
  await startCalibrationServer(port)
  console.log(`calibration server on http://localhost:${port}`)
}
