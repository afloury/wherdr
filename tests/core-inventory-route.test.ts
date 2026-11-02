import { afterEach, expect, it, vi } from 'vitest'
import { createApp, toNodeListener } from 'h3'
import { createServer } from 'node:http'
import { createServer as createSocketServer } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import handler from '../server/api/core/terminals.get'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  vi.unstubAllEnvs()
})
it('exposes only list/get, preserves qualified IDs and bounds browser input', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'inventory-'))
  cleanup.push(() => rm(dir, { recursive: true, force: true }))
  const endpoint = join(dir, 'core.sock')
  const requests: any[] = []
  const terminal = { address: 'host-a/t7', cwd: '/workspace/demo', state: 'live', status: null }
  const core = createSocketServer(socket => socket.once('data', chunk => {
    const request = JSON.parse(chunk.toString())
    requests.push(request)
    const missing = { missing: 'not_found', 'old/t1': 'machine_unknown' }[request.params.terminal as string]
    // Like hc 0.1.16 without machines: `machines` is absent from the list.
    const reply = missing ? { error: { code: -32000, message: missing, data: { kind: missing } } }
      : { result: request.method === 'terminal.list' ? { terminals: [terminal], hidden_finished: 0 } : terminal }
    socket.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, ...reply }) + '\n')
  }))
  await new Promise<void>(resolve => core.listen(endpoint, resolve))
  cleanup.push(() => new Promise(resolve => core.close(() => resolve())))
  vi.stubEnv('HC_SOCKET', endpoint)
  vi.stubEnv('WHERDR_BACKEND', 'core')
  const server = createServer(toNodeListener(createApp().use(handler)))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => new Promise(resolve => server.close(() => resolve())))
  const address = server.address() as { port: number }
  const get = (query = '') => fetch(`http://127.0.0.1:${address.port}/${query}`)
  const list = await (await get()).json()
  expect(list.terminals[0].status).toBeNull()
  expect(list.machines).toEqual([])
  expect((await (await get('?terminal=host-a%2Ft7')).json()).address).toBe('host-a/t7')
  expect(requests.map(r => [r.method, r.params])).toEqual([
    ['terminal.list', {}], ['terminal.get', { terminal: 'host-a/t7' }],
  ])
  expect((await get('?terminal=missing')).status).toBe(404)
  expect((await get('?terminal=old%2Ft1')).status).toBe(404)
  expect((await get('?terminal=')).status).toBe(400)
  expect((await get('?terminal=a&terminal=b')).status).toBe(400)
  vi.stubEnv('WHERDR_BACKEND', 'legacy')
  expect((await get()).status).toBe(503)
  expect(requests).toHaveLength(4)
})
