import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const { exec } = vi.hoisted(() => ({ exec: vi.fn() }))
vi.mock('node:child_process', async (original) => ({ ...await original<object>(), execFile: exec }))
const home = mkdtempSync(path.join(tmpdir(), 'wherdr-diagnostic-'))
const id = 'abcdef0123456789abcdef0123456789'
let machines: typeof import('../server/utils/machines')
beforeAll(async () => {
  vi.stubEnv('HOME', home)
  vi.stubEnv('DATA_DIR', home)
  vi.stubEnv('WHERDR_RUNTIME_DIR', path.join(home, 'runtime'))
  vi.stubEnv('HERDR_WEB_MACHINES', 'on')
  machines = await import('../server/utils/machines')
  vi.spyOn(machines.RemoteMachine.prototype, 'start').mockImplementation(() => {})
  exec.mockImplementation((_bin, _args, _opts, cb) => cb(null, Buffer.from(JSON.stringify([{ id, label: 'Workbox', target: 'workbox', enabled: true }])), ''))
  await machines.refreshMachines()
})
afterAll(() => { machines.stopMachines(); vi.restoreAllMocks(); vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }) })

describe('machine diagnostic transport', () => {
  it('accepts JSON from failed checks (exit 1) and addresses the full saved profile ID', async () => {
    exec.mockImplementation((_bin, _args, _opts, cb) => cb({ code: 1 }, Buffer.from(JSON.stringify([{ id, status: 'auth required', error: 'SSH approval needed' }])), ''))
    expect(await machines.machineDiagnostic('abcdef01')).toMatchObject({ supported: true, status: 'auth required' })
    expect(exec.mock.lastCall?.[1]).toEqual(['machine', 'status', id, '--json'])
  })
  it('falls back only when the command is missing', async () => {
    exec.mockImplementation((_bin, _args, _opts, cb) => cb({ code: 2 }, Buffer.alloc(0), "error: unrecognized subcommand 'status'"))
    expect(await machines.machineDiagnostic('abcdef01')).toMatchObject({ supported: false, reconnect: null })
    exec.mockImplementation((_bin, _args, _opts, cb) => cb({ code: 124 }, Buffer.alloc(0), 'timed out'))
    await expect(machines.machineDiagnostic('abcdef01')).rejects.toMatchObject({ code: 'machine_status', message: 'timed out' })
  })
  it('checks the saved profile for an additional remote session', async () => {
    const remote = machines.getMachine('abcdef01') as import('../server/utils/machines').RemoteMachine
    remote.status = 'online'
    const command = vi.spyOn(remote, 'exec').mockResolvedValue({ code: 0, stdout: Buffer.from(JSON.stringify({ sessions: [{ name: 'extra', running: true }] })), stderr: '' })
    const session = await machines.openSession('abcdef01', 'extra')
    exec.mockImplementation((_bin, _args, _opts, cb) => cb(null, Buffer.from(JSON.stringify([{ id, status: 'reachable' }])), ''))
    expect(await machines.machineDiagnostic(session.key)).toMatchObject({ status: 'reachable' })
    expect(exec.mock.lastCall?.[1]).toEqual(['machine', 'status', id, '--json'])
    command.mockRestore()
  })
  it('rejects unknown and local machines before running any command', async () => {
    exec.mockClear()
    await expect(machines.machineDiagnostic('')).rejects.toMatchObject({ code: 'bad_machine' })
    await expect(machines.machineDiagnostic('missing')).rejects.toMatchObject({ code: 'bad_machine' })
    expect(exec).not.toHaveBeenCalled()
    expect(() => machines.retryMachine('')).toThrow('unknown remote machine')
  })
  it('retries only the selected wherdr connection without running interactive authentication', () => {
    const remote = machines.getMachine('abcdef01') as import('../server/utils/machines').RemoteMachine
    const retry = vi.spyOn(remote, 'retry').mockImplementation(() => {})
    exec.mockClear()
    machines.retryMachine('abcdef01')
    expect(retry).toHaveBeenCalledOnce()
    expect(exec).not.toHaveBeenCalled()
  })
})
