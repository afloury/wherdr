import { afterEach, describe, expect, it } from 'vitest'
import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { bridgeCommand, socketTransport, SocketRelay } from '../server/utils/socketRelay'

const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })

describe('remote socket transport', () => {
  it.each(['/home/test/.config/herdr/herdr.sock', '/Users/test/Library/herdr.sock'])('forwards POSIX path %s', p => {
    expect(socketTransport(p)).toBe('forward')
  })
  it.each(['C:\\Users\\test\\herdr.sock', 'D:/Herdr/herdr.sock', '\\\\host\\pipe', '/c/Users/test\\herdr.sock', 'relative.sock'])('relays non-POSIX path %s', p => {
    expect(socketTransport(p)).toBe('relay')
  })
  it('quotes the binary and named session without embedding the socket path', () => {
    const cmd = bridgeCommand('/opt/Herdr App/herdr', "review's session", false, true)
    const args = execFileSync('sh', ['-c', cmd.replace(/^exec /, "printf '%s\\n' ")], { encoding: 'utf8' }).trim().split('\n')
    expect(args).toEqual(['/opt/Herdr App/herdr', '--session', "review's session", 'remote-api-bridge', '--check'])
    expect(bridgeCommand('herdr', 'default', true)).toContain("'remote-client-bridge'")
  })
})

it('relays raw bytes independently and closes channels when stopped', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-'))
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }))
  const children: ReturnType<typeof spawn>[] = []
  const relay = new SocketRelay(() => {
    const child = spawn(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'])
    children.push(child)
    return child
  })
  cleanups.push(() => relay.stop())
  const sock = path.join(dir, 'bridge.sock')
  await relay.listen(sock)
  const bytes = Buffer.from([0, 255, 128, 10, 13, 1])
  const sockets = [net.createConnection(sock), net.createConnection(sock)]
  cleanups.push(() => sockets.forEach(s => s.destroy()))
  await Promise.all(sockets.map(s => new Promise<void>((resolve, reject) => {
    s.on('error', reject)
    let out = Buffer.alloc(0)
    s.on('data', b => { out = Buffer.concat([out, b]); if (out.length === bytes.length) { expect(out).toEqual(bytes); resolve() } })
    s.on('connect', () => s.write(bytes))
  })))
  expect(children).toHaveLength(2)
  const closed = children.map(c => new Promise(resolve => c.once('close', resolve)))
  relay.stop()
  await Promise.all(closed)
  expect(fs.existsSync(sock)).toBe(false)
})
