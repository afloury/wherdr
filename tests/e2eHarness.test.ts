import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { expect, it } from 'vitest'
import { startFakeHerdr } from './e2e/fake-herdr.mjs'

it('keeps an in-flight Codex observation intact until the next snapshot commits its reset', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hw-snapshot-'))
  const sock = path.join(dir, 'herdr.sock')
  const pane = 'w1:p1'
  const server = await startFakeHerdr({ sock, workspaces: [{ id: 'w1', panes: [
    { id: pane, agent: 'codex', status: 'idle', cwd: '/tmp/project', session: 'existing', pid: 3001 },
  ] }] }) as net.Server
  const call = (method: string, params = {}): Promise<any> => new Promise((resolve, reject) => {
    const conn = net.createConnection(sock)
    let data = ''
    conn.setEncoding('utf8')
    conn.on('error', reject)
    conn.on('connect', () => conn.write(JSON.stringify({ id: method, method, params }) + '\n'))
    conn.on('data', chunk => { data += chunk })
    conn.on('end', () => {
      const reply = JSON.parse(data)
      if (reply.error) reject(new Error(reply.error.message))
      else resolve(reply.result)
    })
  })
  let reset: Promise<any> | undefined
  try {
    const received = Promise.withResolvers<void>()
    // Observe receipt after the fake's request handler, without a timing delay.
    server.on('connection', conn => conn.on('data', chunk => {
      if (String(chunk).includes('e2e.update_reset')) received.resolve()
    }))
    reset = call('e2e.update_reset', { pane_id: pane, onSnapshot: true })
    await received.promise
    expect((await call('pane.get', { pane_id: pane })).pane).toMatchObject({ cwd: '/tmp/project', agent_session: { value: 'existing' } })
    expect((await call('pane.process_info', { pane_id: pane })).process_info.foreground_processes[0].pid).toBe(3001)
    const { snapshot } = await call('session.snapshot')
    const { pid } = await reset
    expect(snapshot.panes[0].cwd).toBe('/tmp/project/fresh')
    expect(snapshot.panes[0].agent_session).toBeUndefined()
    expect(pid).toBe(3002)
    expect((await call('pane.process_info', { pane_id: pane })).process_info.foreground_processes[0].pid).toBe(pid)
  } finally {
    // Release a pending reset even when an assertion before the snapshot fails.
    await call('session.snapshot')
    await reset
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    rmSync(dir, { recursive: true, force: true })
  }
})
