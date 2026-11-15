import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Socket } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import fixture from './fixtures/core-0.1.16.json'
import { checkCore, coreCall, CORE_METHODS } from '../server/utils/core'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup() })
async function fake(reply: (request: any, socket: Socket) => void) {
  const dir = await mkdtemp(join(tmpdir(), 'core-test-'))
  const path = join(dir, 'core.sock')
  const sockets = new Set<Socket>()
  const server = createServer(socket => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    let buffer = ''
    socket.on('data', data => {
      buffer += data.toString()
      if (buffer.includes('\n')) reply(JSON.parse(buffer.trim()), socket)
    })
  })
  await new Promise<void>(resolve => server.listen(path, resolve))
  cleanups.push(async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(dir, { recursive: true, force: true })
  })
  return path
}
function send(socket: Socket, id: number, result: unknown) {
  const line = JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n'
  socket.write(line.slice(0, 9))
  setImmediate(() => socket.end(line.slice(9)))
}
describe('herdr-core plain protocol', () => {
  it('negotiates generation 1 in plain mode and discovers published 0.1.16 capabilities', async () => {
    const requests: any[] = []
    const path = await fake((request, socket) => {
      requests.push(request)
      send(socket, request.id, request.method === 'hello' ? fixture.hello : fixture.discover)
    })
    await expect(checkCore(path)).resolves.toEqual({ version: '0.1.16', generation: 1 })
    expect(requests.map(r => r.method)).toEqual(['hello', 'rpc.discover'])
    expect(requests[0].params).toEqual({ generation: 1, framed: false })
  })
  it.each(CORE_METHODS)('rejects missing capability %s in either advertisement', async missing => {
    for (const side of ['hello', 'discover']) {
      const path = await fake((r, socket) => send(socket, r.id, r.method === 'hello'
        ? { ...fixture.hello, methods: fixture.hello.methods.filter(n => side !== 'hello' || n !== missing) }
        : { methods: fixture.discover.methods.filter(m => side !== 'discover' || m.name !== missing) }))
      await expect(checkCore(path)).rejects.toMatchObject({ kind: 'incompatible', hint: expect.stringContaining(missing) })
    }
  })
  it('rejects a different protocol generation', async () => {
    const path = await fake((r, s) => send(s, r.id, { ...fixture.hello, generation: 2 }))
    await expect(checkCore(path)).rejects.toMatchObject({ kind: 'incompatible' })
  })
  it('preserves stable RPC error kinds and hints without leaking upstream messages', async () => {
    const path = await fake((r, s) => s.end(JSON.stringify({ jsonrpc: '2.0', id: r.id,
      error: { code: -32000, message: 'private details', data: { kind: 'unsupported_generation', hint: 'Upgrade core' } } }) + '\n'))
    await expect(coreCall(path, 'hello')).rejects.toMatchObject({ kind: 'unsupported_generation', hint: 'Upgrade core', message: 'Incompatible herdr-core. Protocol generation 1 is required.' })
  })
  it.each(['garbage\n', '{"jsonrpc":"2.0","id":2,"result":null}\n', '{"jsonrpc":"2.0","id":1,"error":null}\n'])('rejects invalid or uncorrelated replies', async line => {
    const path = await fake((_r, s) => s.end(line))
    await expect(coreCall(path, 'hello')).rejects.toMatchObject({ kind: 'protocol' })
  })
  it('bounds replies and rejects malformed capability documents', async () => {
    const huge = await fake((_r, s) => s.end(Buffer.alloc(16 * 1024 * 1024 + 1, 32)))
    await expect(coreCall(huge, 'hello', {}, 15000)).rejects.toMatchObject({ kind: 'protocol' })
    const path = await fake((r, s) => send(s, r.id, r.method === 'hello' ? fixture.hello : {}))
    await expect(checkCore(path)).rejects.toMatchObject({ kind: 'protocol' })
  }, 20000)
  it('reports unavailable endpoints, disconnects and timeouts', async () => {
    const path = await fake((_r, s) => s.end())
    await expect(coreCall(path, 'hello')).rejects.toMatchObject({ kind: 'disconnected' })
    await expect(coreCall(path + '-missing', 'hello')).rejects.toMatchObject({ kind: 'unavailable' })
    const silent = await fake(() => {})
    await expect(coreCall(silent, 'hello', {}, 20)).rejects.toMatchObject({ kind: 'timeout' })
  })
})
