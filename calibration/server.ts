import { createServer, type Server } from 'node:http'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, extname, normalize } from 'node:path'
import { findCase } from './corpus.ts'

const PAGES_DIR = join(import.meta.dirname, 'pages')
const REPORTS_DIR = join(import.meta.dirname, 'out', 'reports')
export const CALIBRATION_PORT = 8765

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
}

/**
 * Serves corpus cases at /case/<name>, static pages, and stores reports POSTed to /report/<name>.
 * @param port TCP port on localhost
 * @returns the listening server, or null when another calibration server already holds the port
 */
export function startCalibrationServer(port = CALIBRATION_PORT): Promise<Server | null> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const send = (status: number, type: string, body: string | Buffer) =>
      res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }).end(body)

    if (req.method === 'POST' && url.pathname.startsWith('/report/')) {
      const name = url.pathname.slice('/report/'.length).replace(/[^\w.-]/g, '_')
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      await mkdir(REPORTS_DIR, { recursive: true })
      await writeFile(join(REPORTS_DIR, `${name}.json`), Buffer.concat(chunks))
      res.writeHead(204).end()
      return
    }
    if (url.pathname.startsWith('/case/')) {
      const file = url.pathname.slice('/case/'.length)
      const corpusCase = findCase(file.replace(/\.webmanifest$/, ''))
      if (!corpusCase) return send(404, 'text/plain', 'unknown case')
      if (file.endsWith('.webmanifest')) return send(200, CONTENT_TYPES['.webmanifest']!, JSON.stringify(corpusCase.manifest ?? {}))
      const reportId = url.searchParams.get('report')
      return send(200, CONTENT_TYPES['.html']!, reportId ? corpusCase.html.replace('</body>', `${reporterScript(reportId)}</body>`) : corpusCase.html)
    }
    const path = normalize(url.pathname)
    try {
      send(200, CONTENT_TYPES[extname(path)] ?? 'application/octet-stream', await readFile(join(PAGES_DIR, path)))
    } catch {
      send(404, 'text/plain', 'not found')
    }
  })
  return new Promise((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => error.code === 'EADDRINUSE' ? resolve(null) : reject(error))
    server.listen(port, () => resolve(server))
  })
}

function reporterScript(reportId: string) {
  return `<script>
(() => {
  const states = []
  const report = label => {
    states.push({ label, inner: [innerWidth, innerHeight], scrollY, visualViewport: [visualViewport.width, visualViewport.height, visualViewport.offsetTop],
      scheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light', standalone: navigator.standalone })
    fetch('/report/${reportId}', { method: 'POST', body: JSON.stringify(states) })
  }
  addEventListener('load', () => setTimeout(() => report('load'), 300))
  addEventListener('scrollend', () => report('scrollend'))
})()
</script>`
}

if (import.meta.main) {
  await startCalibrationServer(Number(process.env.PORT ?? CALIBRATION_PORT))
  console.log(`calibration server on http://localhost:${process.env.PORT ?? CALIBRATION_PORT}`)
}
