// A remote machine whose SSH sessions are refused reopens its master
// connection by itself (fake ssh: tests/helpers/fake-ssh.sh).
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const dir = fs.mkdtempSync(path.join(tmpdir(), 'wherdr-ssh-'))
const runtime = path.join(dir, 'run')
const fakeSsh = path.join(__dirname, 'helpers/fake-ssh.sh')
let machines: typeof import('../server/utils/machines')
let current: import('../server/utils/machines').RemoteMachine | null = null

beforeAll(async () => {
  fs.chmodSync(fakeSsh, 0o755)
  vi.stubEnv('HOME', dir)
  vi.stubEnv('DATA_DIR', dir)
  vi.stubEnv('WHERDR_RUNTIME_DIR', runtime)
  vi.stubEnv('SSH_BIN', fakeSsh)
  vi.stubEnv('FAKE_SSH_DIR', dir)
  machines = await import('../server/utils/machines')
})
afterEach(() => {
  current?.stop()
  current = null
  fs.rmSync(path.join(dir, 'refuse'), { force: true })
  fs.rmSync(path.join(dir, 'log'), { force: true })
})
afterAll(() => { vi.unstubAllEnvs(); fs.rmSync(dir, { recursive: true, force: true }) })

const sshLog = () => { try { return fs.readFileSync(path.join(dir, 'log'), 'utf8').split('\n').filter(Boolean) } catch { return [] } }
const masters = () => sshLog().filter(l => l.startsWith('master '))

function startMachine() {
  const statuses: string[] = []
  const m = new machines.RemoteMachine({ key: 'abcd1234', id: 'abcd1234abcd1234', label: 'Fake', target: 'fakehost', session: 'default' }, () => statuses.push(m.status))
  current = m
  m.start()
  return { m, statuses }
}
const online = (m: import('../server/utils/machines').RemoteMachine) => vi.waitFor(() => expect(m.status).toBe('online'), { timeout: 20000, interval: 50 })

describe('SSH session refusals', () => {
  it('reconnects when the control socket of a running master disappears', async () => {
    const { m, statuses } = startMachine()
    await online(m)
    const first = m.ctl
    expect((await m.exec('true')).code).toBe(0)
    // What an older master exiting late used to do: remove the control path in use.
    fs.rmSync(first)
    const r = m.exec('true')
    await vi.waitFor(() => expect(m.status).toBe('connecting'), { timeout: 10000, interval: 20 })
    expect(m.error).toBe('SSH control connection lost')
    await online(m)
    expect(m.ctl).not.toBe(first)
    expect(statuses).toContain('connecting')
    await r
    expect((await m.exec('true')).code).toBe(0)
  }, 45000)

  it('reopens the connection after refusals in a row, without retrying in a burst', async () => {
    const { m } = startMachine()
    await online(m)
    fs.writeFileSync(path.join(dir, 'refuse'), '')
    const r = await m.exec('true')
    expect(r.code).toBe(255)
    await vi.waitFor(() => expect(m.status).not.toBe('online'), { timeout: 10000, interval: 20 })
    expect(m.error).toBe('SSH sessions refused')
    // sshd keeps refusing: the probe fails, reconnections slow down.
    await new Promise(res => setTimeout(res, 3500))
    expect(masters().length).toBeLessThanOrEqual(4)
    fs.rmSync(path.join(dir, 'refuse'))
    await vi.waitFor(() => expect(m.status).toBe('online'), { timeout: 30000, interval: 50 })
    expect((await m.exec('true')).code).toBe(0)
  }, 60000)

  it('counts a refused terminal: a terminal retrying alone also brings the connection back', async () => {
    const { m } = startMachine()
    await online(m)
    fs.writeFileSync(path.join(dir, 'refuse'), '')
    for (let i = 0; i < 3; i++) {
      const child = m.spawnHerdr(['terminal', 'session', 'control', 'p1'])
      await new Promise(res => child.on('close', res))
    }
    await vi.waitFor(() => expect(m.status).not.toBe('online'), { timeout: 10000, interval: 20 })
    fs.rmSync(path.join(dir, 'refuse'))
    await online(m)
  }, 45000)

  it('an accepted terminal ends the refusal streak: refusals between successes never reconnect', async () => {
    const { m } = startMachine()
    await online(m)
    // The upload purge run after connecting must not meet the refusals below.
    await vi.waitFor(() => expect(sshLog()).toContain('session ok'), { timeout: 10000, interval: 20 })
    const first = m.ctl
    const term = async () => {
      const child = m.spawnHerdr(['terminal', 'session', 'control', 'p1'])
      child.stdout.resume()
      await new Promise(res => child.on('close', res))
    }
    const streaks: number[] = []
    for (let i = 0; i < 3; i++) {
      fs.writeFileSync(path.join(dir, 'refuse'), '')
      await term()
      streaks.push(m.gate.stats().streak)
      fs.rmSync(path.join(dir, 'refuse'))
      await term()
      streaks.push(m.gate.stats().streak)
    }
    expect(streaks).toEqual([1, 0, 1, 0, 1, 0])
    await new Promise(res => setTimeout(res, 300))
    expect(m.status).toBe('online')
    expect(m.ctl).toBe(first)
    expect(masters().length).toBe(1)
  }, 45000)

  it('stops a master left behind by a previous wherdr and removes its control socket', async () => {
    fs.mkdirSync(runtime, { recursive: true })
    const old = path.join(runtime, 'abcd1234.ctl')
    const leftover = spawn(fakeSsh, ['-M', '-S', old, '-N', '--', 'fakehost'], { stdio: 'ignore', env: { ...process.env, FAKE_SSH_DIR: dir } })
    await vi.waitFor(() => expect(fs.existsSync(old)).toBe(true), { timeout: 3000, interval: 20 })
    const exited = new Promise(res => leftover.on('exit', res))
    const { m } = startMachine()
    await online(m)
    await exited
    expect(fs.existsSync(old)).toBe(false)
    expect(m.ctl).not.toBe(old)
  }, 45000)
})

describe('control socket names', () => {
  it('a new path per connection, carrying the wherdr process', () => {
    expect(machines.ctlName('abcd1234', 42, 3)).toBe('abcd1234.42.3.ctl')
  })
  it('only sockets of stopped wherdr processes, and the old fixed name, are stale', () => {
    const files = ['abcd1234.ctl', 'abcd1234.10.1.ctl', 'abcd1234.20.4.ctl', 'abcd1234.sock', 'ffff0000.10.1.ctl', 'abcd1234x.10.1.ctl']
    expect(machines.staleCtls(files, 'abcd1234', pid => pid === 20)).toEqual(['abcd1234.ctl', 'abcd1234.10.1.ctl'])
  })
})
