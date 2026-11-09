import { describe, expect, it } from 'vitest'
import { KILL_SCRIPT, PROCS_SCRIPT, groupTargets, orphanTargets, parseProcs, seconds, type Proc } from '../shared/pm/procs'
import { killTerminal, leftoversKilled, sweepOrphans } from '../server/utils/pmProcs'
import type { PmLaunchDeps } from '../server/utils/pmLaunch'

const ROOT = '/home/user/.wherdr/pm/worktrees'
const p = (pid: number, ppid: number, pgid: number, comm = 'sh', cwd?: string, age = 60): Proc => ({ pid, ppid, pgid, age, comm, ...(cwd ? { cwd } : {}) })
// What PROCS_SCRIPT prints for these processes.
const text = (procs: Proc[]) => procs.map(x => [`p${x.pid}`, `P${x.ppid}`, `g${x.pgid}`, `t${x.age}`, `c${x.comm}`, ...(x.cwd ? [`n${x.cwd}`] : [])].join('\n')).join('\n')

describe('reading ps', () => {
  it('reads each field, ps\'s elapsed time and a deleted folder', () => {
    expect(seconds('05:03')).toBe(303)
    expect(seconds('1-06:00:00')).toBe(108_000)
    const out = 'p7\nP1\ng7\nt06:00:01\nc/bin/sh\np7\nn/home/user/x (deleted)\np8\nP7\ng7\nt01\ncCode Helper'
    expect(parseProcs(out)).toEqual([p(7, 1, 7, '/bin/sh', '/home/user/x', 21_601), p(8, 7, 7, 'Code Helper', undefined, 1)])
  })
})

describe('the group kill', () => {
  // herdr-core 10 (group 10) runs the terminal's shell 20; claude 21 runs a test
  // runner 30 in its own group; its sh 31 was re-parented to init but keeps group 30.
  const procs = [p(1, 0, 1, 'launchd'), p(10, 1, 10, 'herdr-core'), p(20, 10, 20), p(21, 20, 20, 'claude'),
    p(30, 21, 30, 'node'), p(31, 1, 30), p(40, 10, 40), p(50, 1, 50, 'vim')]
  it('kills the shell\'s tree and every group in it, never herdr-core, init or another terminal', () => {
    expect(groupTargets(procs, 20)).toEqual([20, 21, 30, 31])
  })
  it('a shell that shares herdr-core\'s group leaves that group alone', () => {
    expect(groupTargets([p(10, 1, 10, 'herdr-core'), p(20, 10, 10), p(21, 20, 10), p(60, 10, 10)], 20)).toEqual([20, 21])
  })
  it('kills the processes after the terminal, with what was read before', async () => {
    const calls: string[] = []
    const deps = { call: async (method: string, params: { argv?: string[], on?: string }) => {
      const script = params.argv?.[2]
      calls.push(script === PROCS_SCRIPT ? `ps@${params.on}` : script === KILL_SCRIPT ? `kill@${params.on} ${params.argv!.slice(4).join(' ')}` : method)
      if (method === 'terminal.get') return { pid: 20 }
      if (method === 'terminal.kill') throw new Error('gone')
      return { code: 0, stdout: Buffer.from(text(procs)).toString('base64') }
    } } as unknown as PmLaunchDeps
    await expect(killTerminal(deps, 'vps/t-1')).rejects.toThrow('gone')
    expect(calls).toEqual(['terminal.get', 'ps@vps', 'terminal.kill', 'kill@vps 20 21 30 31'])
  })
})

describe('the orphan sweep', () => {
  const done = `${ROOT}/WH-1`, live = `${ROOT}/WH-2`
  const procs = [
    p(1, 0, 1, '/sbin/launchd'),
    p(100, 1, 100, 'sh', done, 21_600), p(101, 100, 100, 'ffmpeg', '/tmp/x'), // a finished task's test, re-parented
    p(110, 1, 110, 'sh', `${done}/.wherdr-tmp/v`, 30), // in its temp folder
    p(120, 1, 120, 'sh', `${ROOT}/WH-9`), // a removed task
    p(200, 1, 200, 'sh', live), // a live agent's
    p(300, 1, 300, 'Terminal'), p(301, 300, 301, 'zsh', done), // the user's shell there
    p(400, 1, 400, 'code'), p(401, 400, 400, 'node', done), // the user's editor
    p(500, 1, 500, 'sh', '/home/user/project'), // the user's own, elsewhere
    p(600, 1, 600, 'node', `${done}`), // wherdr itself, kept
  ]
  it('kills a finished or removed task\'s detached processes and what they started, nothing else', () => {
    expect(orphanTargets(procs, ROOT, id => id === 'WH-2', [600])).toEqual([
      { task: 'WH-1', pids: [100, 101, 110], age: 21_600 },
      { task: 'WH-9', pids: [120], age: 60 },
    ])
  })
  it('a subreaper like systemd --user counts as init', () => {
    expect(orphanTargets([p(5, 1, 5, 'systemd'), p(6, 5, 6, 'sh', done)], ROOT, () => false)).toEqual([{ task: 'WH-1', pids: [6], age: 60 }])
  })
  it('logs the kill on the task and counts it for the machine', async () => {
    const logs: string[] = [], kills: string[][] = []
    const deps = {
      machines: () => [{ key: '', label: 'here', local: true, status: 'online' }],
      call: async (_m: string, params: { argv: string[] }) => {
        const script = params.argv[2]
        if (script === KILL_SCRIPT) kills.push(params.argv.slice(4))
        const out = script === PROCS_SCRIPT ? text(procs) : '/home/user'
        return { code: 0, stdout: Buffer.from(out).toString('base64') }
      },
      store: {
        enabled: async () => true,
        runs: async () => [{ task: 'WH-1', machine: '', state: 'ended' }, { task: 'WH-2', machine: '', state: 'running' }],
        task: async (id: string) => (id === 'WH-1' ? { id } : undefined),
        logTask: async (_t: unknown, _by: string, line: string) => { logs.push(line) },
      },
    } as unknown as PmLaunchDeps
    await sweepOrphans(deps)
    expect(kills.map(k => k.join(' '))).toEqual(['100 101 110 600', '120'])
    expect(logs).toEqual(['killed 4 leftover processes, 6 h old'])
    expect(leftoversKilled('')).toBe(5)
  })
})
