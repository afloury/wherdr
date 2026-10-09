// Docker has no `tailscale` command: wherdr reads Tailscale's state from its
// socket (mounted by docker-compose.yml). Here a fake local API on a Unix
// socket answers what tailscaled would.
import { mkdtempSync, rmSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { inspect, tailscaledSocket } from '../bin/lib/tailnet.mjs'

const NAME = 'host.example.ts.net'
const dir = mkdtempSync(path.join(os.tmpdir(), 'wherdr-ts-'))
const socket = path.join(dir, 'tailscaled.sock')
const seen: { url: string, host: string }[] = []
const answers = {
  status: JSON.stringify({ BackendState: 'Running', Self: { DNSName: `${NAME}.` }, CertDomains: [NAME] }),
  serve: JSON.stringify({ Web: { [`${NAME}:7683`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:7683' } } } } }),
}
const server = http.createServer((req, res) => {
  seen.push({ url: req.url || '', host: req.headers.host || '' })
  if (req.method !== 'GET') { res.statusCode = 405; res.end(); return }
  if (req.url === '/localapi/v0/status?peers=false') res.end(answers.status)
  else if (req.url === '/localapi/v0/serve-config') res.end(answers.serve)
  else { res.statusCode = 404; res.end('not found') }
})

beforeAll(() => new Promise<void>(resolve => server.listen(socket, resolve)))
afterAll(() => { server.close(); rmSync(dir, { recursive: true, force: true }) })

describe('Tailscale read from its socket', () => {
  it('finds the socket only where it exists', () => {
    expect(tailscaledSocket({ WHERDR_TAILSCALED_SOCKET: socket })).toBe(socket)
    expect(tailscaledSocket({ WHERDR_TAILSCALED_SOCKET: path.join(dir, 'missing.sock') })).toBeNull()
  })

  it('reads the machine name and the address published for wherdr, without a CLI', async () => {
    const net = await inspect('7683', null, socket)
    expect(net).toMatchObject({ installed: true, connected: true, https: true, name: NAME, phone: { url: `https://${NAME}:7683/`, served: true }, served: [`https://${NAME}:7683/`] })
    // Only reads, with the host name Tailscale's local API expects.
    expect(seen.every(r => r.host === 'local-tailscaled.sock')).toBe(true)
  })

  it('reports nothing published, and the unknown when the socket does not answer', async () => {
    answers.serve = '{}'
    expect((await inspect('7683', null, socket)).served).toEqual([])
    answers.serve = 'oops'
    expect((await inspect('7683', null, socket)).served).toBeNull()
    expect((await inspect('7683', null, path.join(dir, 'missing.sock'))).served).toBeNull()
    expect(await inspect('7683', null, null)).toEqual({ installed: false })
  })
})
