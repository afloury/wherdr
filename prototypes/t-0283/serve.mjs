// Static server for the demo build under /demo/ (t-0283 mock-ups, throwaway).
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon' }
export function serve(root, port) {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/demo/, '')
    for (const p of [join(root, path), join(root, '200.html')]) {
      try {
        const body = await readFile(p)
        res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' })
        return res.end(body)
      } catch { /* next */ }
    }
    res.writeHead(404).end()
  })
  return new Promise(r => server.listen(port, '127.0.0.1', () => r(server)))
}
