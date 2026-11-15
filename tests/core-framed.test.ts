import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Socket } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { FRAME, coreFrame, openFramed, readFrames } from '../server/utils/coreFramed'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup() })

describe('framed codec', () => {
  it('round-trips frames split across chunks', () => {
    const bytes = Buffer.concat([coreFrame(0, FRAME.DATA, Buffer.from('{"a":1}')), coreFrame(7, FRAME.CREDIT, Buffer.from([1, 2, 3, 4]))])
    const seen: [number, number, string][] = []
    const rest = readFrames(bytes.subarray(0, 20), (c, k, p) => seen.push([c, k, p.toString('hex')]))
    expect(seen).toEqual([[0, 0, Buffer.from('{"a":1}').toString('hex')]])
    readFrames(Buffer.concat([rest, bytes.subarray(20)]), (c, k, p) => seen.push([c, k, p.toString('hex')]))
    expect(seen[1]).toEqual([7, 1, '01020304'])
  })
  it('refuses a frame above 16 MiB', () => {
    const head = Buffer.alloc(9)
    head.writeUInt32LE(16 * 1024 * 1024 + 1, 5)
    expect(() => readFrames(head, () => {})).toThrow(/too large/)
  })
})

describe('openFramed', () => {
  it('switches to framed mode after hello, then correlates calls and keeps early stream frames', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'core-framed-'))
    const path = join(dir, 'core.sock')
    const sockets = new Set<Socket>()
    const server = createServer((socket) => {
      sockets.add(socket)
      let buf = Buffer.alloc(0)
      let framed = false
      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk])
        if (!framed) {
          const end = buf.indexOf(10)
          const hello = JSON.parse(buf.subarray(0, end).toString())
          expect(hello.params).toEqual({ generation: 1, framed: true })
          socket.write(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { generation: 1, framed: true } }) + '\n')
          framed = true
          buf = buf.subarray(end + 1)
        }
        buf = readFrames(buf, (_c, _k, payload) => {
          const call = JSON.parse(payload.toString())
          // A stream frame before the reply: the client keeps it for its handler.
          socket.write(coreFrame(5, FRAME.DATA, Buffer.from('early')))
          socket.write(coreFrame(0, FRAME.DATA, Buffer.from(JSON.stringify(call.method === 'boom'
            ? { jsonrpc: '2.0', id: call.id, error: { code: -32000, message: 'no terminal', data: { kind: 'not_found' } } }
            : { jsonrpc: '2.0', id: call.id, result: { channel: 5 } }))))
        })
      })
    })
    await new Promise<void>(resolve => server.listen(path, resolve))
    cleanups.push(async () => {
      for (const s of sockets) s.destroy()
      await new Promise<void>(resolve => server.close(() => resolve()))
      await rm(dir, { recursive: true, force: true })
    })
    const core = await openFramed(path)
    expect(await core.call<{ channel: number }>('terminal.attach', {})).toEqual({ channel: 5 })
    const got: string[] = []
    core.stream(5, (kind, payload) => got.push(`${kind}:${payload}`))
    expect(got).toEqual(['0:early'])
    await expect(core.call('boom')).rejects.toMatchObject({ kind: 'not_found' })
    core.close()
  })
  it('rejects a core that does not switch to framed mode', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'core-framed-'))
    const path = join(dir, 'core.sock')
    const server = createServer(s => s.once('data', () => s.write(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { generation: 1, framed: false } }) + '\n')))
    await new Promise<void>(resolve => server.listen(path, resolve))
    cleanups.push(async () => {
      await new Promise<void>(resolve => server.close(() => resolve()))
      await rm(dir, { recursive: true, force: true })
    })
    await expect(openFramed(path)).rejects.toMatchObject({ kind: 'incompatible' })
  })
})
