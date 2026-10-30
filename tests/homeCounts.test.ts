import { describe, expect, it } from 'vitest'
import type { LinkedTask, MachineLinks } from '../shared/boardLinks'
import { homeCounts, taskStat, withBoardGroups } from '../shared/homeCounts'
import { type MachineTasks, type TasksBoard, parseTaskRow } from '../shared/projectsTasks'

type P = { id: string, agent: string | null, status: string, workspace: string, machine?: string }
const pane = (id: string, status: string, agent: string | null = 'claude'): P => ({ id, agent, status, workspace: id.split(':')[0]! })
const task = (n: number, panes: LinkedTask['panes'], stage = 'working', group: LinkedTask['group'] = 'working'): LinkedTask => ({
  id: `app/${n}`, repo: 'app', n, key: `APP-${n}`, title: `Task ${n}`, panes, workspace: `w${n}`, stage, group, progress: null, msg: '', since: null,
})
const links = (tasks: LinkedTask[], machine = ''): MachineLinks => ({ machine, tasks, coordinators: [] })
// A row as `list --json` gives it.
const row = (n: number, state: string, stage: string, extra: Record<string, unknown> = {}) => parseTaskRow({ id: `app/${n}`, state, stage, title: `Task ${n}`, ...extra })!
const machine = (rows: ReturnType<typeof row>[], key = '', more: Partial<MachineTasks> = {}): MachineTasks => ({ machine: key, status: 'ready', version: '1.2.16', tasks: rows, ...more })
const cli = (...machines: MachineTasks[]): TasksBoard => ({ version: 'v', machines })

describe('home counters', () => {
  // WHR-181 ready to approve and WHR-178 stopped at its limit: both idle in
  // their terminal, both the user's turn.
  const readyToApprove = row(181, 'blocked', 'approval', { kind: 'permission' })
  const needsYou = row(178, 'blocked', 'stopped')
  const exited = row(9, 'error', 'working', { msg: 'The agent has exited' })
  const working = row(5, 'working', 'working')
  const done = row(4, 'done', 'done')

  it('reads the groups as the Board does', () => {
    expect([readyToApprove, needsYou, exited, working, done].map(r => r.group)).toEqual(['ready', 'needs', 'needs', 'working', 'done'])
    expect(['needs', 'ready', 'working', 'todo', 'done'].map(g => taskStat(g as never))).toEqual(['blocked', 'blocked', 'working', 'ready', 'ready'])
    expect(taskStat('working', 'blocked')).toBe('blocked')
  })

  it('without herdr-projects (Herdr alone): each agent by its own state', () => {
    const panes = [pane('w1:p1', 'blocked'), pane('w2:p1', 'working'), pane('w3:p1', 'idle'), pane('w4:p1', 'done'), pane('w5:p1', 'unknown')]
    expect(homeCounts(panes, [], null)).toEqual({ blocked: 1, working: 1, ready: 2 })
    // A board that is not there says nothing either.
    expect(homeCounts(panes, [], cli({ machine: '', status: 'missing', version: '', tasks: [] }))).toEqual({ blocked: 1, working: 1, ready: 2 })
  })

  it('a board task counts by its state on the Board, not its terminal', () => {
    const l = [links([task(181, [{ id: 'w181:p1', role: 'worker' }], 'approval', 'ready'), task(178, [{ id: 'w178:p1', role: 'worker' }], 'stopped', 'needs'),
      task(9, [{ id: 'w9:p1', role: 'worker' }]), task(5, [{ id: 'w5:p1', role: 'worker' }]), task(4, [{ id: 'w4:p1', role: 'worker' }], 'done', 'done')])]
    const panes = [pane('w181:p1', 'idle'), pane('w178:p1', 'idle'), pane('w9:p1', 'working'), pane('w5:p1', 'working'), pane('w4:p1', 'idle'), pane('w99:p1', 'working')]
    // Before: the terminals only.
    expect(homeCounts(panes, l, null)).toEqual({ blocked: 0, working: 3, ready: 3 })
    expect(homeCounts(panes, l, cli(machine([readyToApprove, needsYou, exited, working, done])))).toEqual({ blocked: 3, working: 2, ready: 1 })
  })

  it('a task with a reviewer (and attempts) counts once', () => {
    const l = [links([task(7, [{ id: 'w7:p1', role: 'worker' }, { id: 'w7:p2', role: 'reviewer', kind: 'codex' }, { id: 'w8:p1', role: 'attempt', letter: 'A' }])])]
    const panes = [pane('w7:p1', 'idle'), pane('w7:p2', 'working', 'codex'), pane('w8:p1', 'idle')]
    // In two spaces, the panes alone count it twice; the Board's state once.
    expect(homeCounts(panes, l, null)).toEqual({ blocked: 0, working: 1, ready: 1 })
    expect(homeCounts(panes, l, cli(machine([row(7, 'working', 'reviewing')])))).toEqual({ blocked: 0, working: 1, ready: 0 })
  })

  it('a task that waits for you counts with no agent pane left', () => {
    const board = cli(machine([needsYou, exited, readyToApprove, working, done, row(3, 'idle', 'todo'), row(2, 'blocked', 'asks', { archivedAt: 1 })]))
    expect(homeCounts([], [], board)).toEqual({ blocked: 3, working: 0, ready: 0 })
    // Its panes were filtered out as stale: still once.
    const l = [links([task(178, [{ id: 'w178:p1', role: 'worker' }], 'stopped', 'needs')])]
    expect(homeCounts([pane('w178:p1', 'idle')], l, board, () => false)).toEqual({ blocked: 3, working: 0, ready: 0 })
    expect(homeCounts([pane('w178:p1', 'idle')], l, board)).toEqual({ blocked: 3, working: 0, ready: 0 })
  })

  it('follows the machine bar; a board whose CLI did not answer keeps the terminals', () => {
    const l = [links([task(9, [{ id: 'w9:p1', role: 'worker' }])], 'pi')]
    const panes = [{ ...pane('w9:p1', 'working'), machine: 'pi' }, pane('w1:p1', 'working')]
    const board = cli(machine([exited, needsYou], 'pi'))
    const onlyHere = (p: P) => (p.machine || '') === ''
    expect(homeCounts(panes, l, board, onlyHere, m => m === '')).toEqual({ blocked: 0, working: 1, ready: 0 })
    expect(homeCounts(panes, l, board, p => p.machine === 'pi', m => m === 'pi')).toEqual({ blocked: 2, working: 0, ready: 0 })
    expect(homeCounts(panes, l, cli(machine([exited], 'pi', { error: 'pi is unreachable', stale: true })))).toEqual({ blocked: 0, working: 2, ready: 0 })
  })
})

describe('task groups on the home cards', () => {
  it('take the CLI\'s state over the stage in the file', () => {
    const l = [links([task(9, [{ id: 'w9:p1', role: 'worker' }]), task(5, [{ id: 'w5:p1', role: 'worker' }])], 'pi')]
    const out = withBoardGroups(l, cli(machine([row(9, 'error', 'working', { msg: 'The agent has exited' }), row(5, 'working', 'working')], 'pi')))
    expect(out[0]!.tasks.map(t => [t.id, t.stage, t.group])).toEqual([['app/9', 'working', 'needs'], ['app/5', 'working', 'working']])
    // Another board's rows, or none: the files' groups stay.
    expect(withBoardGroups(l, cli(machine([row(9, 'error', 'working')], 'other')))).toBe(l)
    expect(withBoardGroups(l, null)).toBe(l)
  })
})
