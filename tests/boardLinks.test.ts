import { describe, expect, it } from 'vitest'
import { reduceSnapshot } from '../server/utils/snapshot'
import { spaceRows } from '../shared/spaces'
import {
  type MachineLinks, boardSections, coordinatorFromFile, elapsedLabel, linksFromTaskFile, memberTag,
  parseRepoGit, tasksFromFiles, tasksIn,
} from '../shared/boardLinks'

// A Herdr session as herdr-projects 1.2.1 leaves it: the coordinators as tabs of
// one space ("herdr-projects"), the repo's own space (a shell in the clone), the
// tasks' worktree spaces linked to it by Herdr (same repo_key), and spaces of
// the user's own.
const REPO_KEY = '/home/u/dev/app/.git'
const wt = (linked: boolean, path: string) => ({ checkout_path: path, is_linked_worktree: linked, repo_key: REPO_KEY, repo_name: 'app', repo_root: '/home/u/dev/app' })
type RawPane = { pane_id: string, workspace_id: string, tab_id: string, agent: string | null, agent_status: string }
const pane = (id: string, agent: string | null = 'claude', status = 'idle'): RawPane => ({ pane_id: id, workspace_id: id.split(':')[0]!, tab_id: `${id.split(':')[0]}:t${id.endsWith('p9') ? 2 : 1}`, agent, agent_status: agent ? status : 'unknown' })
function snapshot(machine = '') {
  const workspaces = [
    { workspace_id: 'w1', label: 'herdr-projects', number: 1 },
    { workspace_id: 'w2', label: 'app', number: 2, worktree: wt(false, '/home/u/dev/app') },
    { workspace_id: 'w3', label: 'APP-1 Login redirect', number: 3, worktree: wt(true, '/home/u/wt/app-1') },
    { workspace_id: 'w4', label: 'APP-2 Rate limits', number: 4, worktree: wt(true, '/home/u/wt/app-2') },
    { workspace_id: 'w5', label: 'notes', number: 5 },
    { workspace_id: 'w6', label: 'spike', number: 6, worktree: wt(true, '/home/u/wt/spike') },
  ]
  const panes = [
    pane('w1:p1', 'claude', 'idle'), pane('w1:p2', 'claude', 'working'),
    pane('w2:p1', null),
    pane('w3:p1', 'claude', 'working'), pane('w3:p9', 'codex', 'blocked'),
    pane('w4:p1', 'codex', 'blocked'),
    pane('w5:p1', 'claude', 'done'),
    pane('w6:p1', 'claude', 'idle'),
  ]
  const tabs = [...new Set(panes.map(p => p.tab_id))].map((id, i) => ({ tab_id: id, workspace_id: id.split(':')[0], label: String(i + 1), number: Number(id.split(':t')[1]) }))
  return reduceSnapshot({ workspaces, tabs, panes }, machine)
}
const SOCK = '/home/u/.config/herdr/herdr.sock'
const local = (socket: unknown) => (socket === SOCK || socket == null ? '' : null)

const links = (): MachineLinks => ({
  machine: '',
  coordinators: [
    { level: 'top', pane: 'w1:p1', workspace: 'w1' },
    { level: 'project', repo: 'app', pane: 'w1:p2', workspace: 'w1' },
  ],
  tasks: tasksFromFiles([
    linksFromTaskFile({ id: 'app/1', title: 'Login  redirect', stage: 'reviewing', reviewAt: 5000, since: 1000, watch: { progress: 42.4, msg: 'Checking the loop' }, link: { socket: SOCK, pane: 'w3:p1', workspace: 'w3', ownsWorkspace: true, reviewer: { pane: 'w3:p9' } } }, local)!,
    linksFromTaskFile({ id: 'app/2', title: 'Rate limits', stage: 'working', since: 1000, workAt: 2000, msg: 'Writing tests', link: { socket: SOCK, pane: 'w4:p1', workspace: 'w4', ownsWorkspace: true } }, local)!,
  ], { app: 'APP' }),
  repos: [{ repo: 'app', root: '/home/u/dev/app', branch: 'main', behind: 38 }],
})

describe('reading the board\'s files', () => {
  it('a task: its panes by role, its space, its report', () => {
    const t = links().tasks.find(x => x.id === 'app/1')!
    expect(t).toMatchObject({ key: 'APP-1', title: 'Login redirect', workspace: 'w3', progress: 42, msg: 'Checking the loop', since: 5000, stage: 'reviewing' })
    expect(t.panes).toEqual([{ id: 'w3:p1', role: 'worker' }, { id: 'w3:p9', role: 'reviewer' }])
    // The worker's turn: the later of `since` and `workAt`; the task's own line without a watcher's.
    expect(links().tasks.find(x => x.id === 'app/2')).toMatchObject({ since: 2000, msg: 'Writing tests', progress: null })
  })

  it('an attempt joins its task; a session wherdr has not opened names no pane', () => {
    const attempt = linksFromTaskFile({ id: 'app/3b', attemptOf: 'app/3', letter: 'B', link: { socket: SOCK, pane: 'w7:p1' } }, local)!
    const own = linksFromTaskFile({ id: 'app/3', title: 'Two ways', link: { socket: '/x/sessions/other/herdr.sock', pane: 'w8:p1' } }, local)!
    expect(own.panes).toEqual([])
    const [t] = tasksFromFiles([own, attempt], {})
    expect(t).toMatchObject({ id: 'app/3', key: '#3', panes: [{ id: 'w7:p1', role: 'attempt', letter: 'B' }] })
    // An attempt that does not name its task, a bad id, a remote pane id: refused.
    expect(linksFromTaskFile({ id: 'app/3b', attemptOf: 'app/4' }, local)).toBeNull()
    expect(linksFromTaskFile({ id: '../x/1' }, local)).toBeNull()
    expect(linksFromTaskFile({ id: 'app/5', link: { pane: 'abc~w1:p1' } }, local)!.panes).toEqual([])
  })

  it('remote machines prefix the ids; tasks with nothing open are left out', () => {
    const t = linksFromTaskFile({ id: 'app/4', link: { pane: 'w2:p3', workspace: 'w2', ownsWorkspace: true } }, () => '0a1b2c3d')!
    expect(t).toMatchObject({ panes: [{ id: '0a1b2c3d~w2:p3', role: 'worker' }], workspace: '0a1b2c3d~w2' })
    expect(tasksFromFiles([linksFromTaskFile({ id: 'app/6', link: null }, local)!], {})).toEqual([])
  })

  it('coordinator state files', () => {
    expect(coordinatorFromFile('top', { socket: SOCK, pane: 'w1:p1', space: 'w1' }, local)).toEqual({ level: 'top', pane: 'w1:p1', workspace: 'w1' })
    expect(coordinatorFromFile('project', { socket: SOCK, pane: 'w1:p2' }, local, 'web')).toEqual({ level: 'project', repo: 'web', pane: 'w1:p2', workspace: null })
    expect(coordinatorFromFile('machine', { socket: SOCK, pane: null, space: null }, local)).toBeNull()
    expect(coordinatorFromFile('project', { pane: 'w1:p2', repo: '../etc' }, local)).toBeNull()
  })

  it('git: branch and behind count', () => {
    expect(parseRepoGit('main\t38\n')).toEqual({ branch: 'main', behind: 38 })
    expect(parseRepoGit('feature/x\t\n')).toEqual({ branch: 'feature/x', behind: null })
    expect(parseRepoGit('')).toEqual({ branch: '', behind: null })
  })
})

describe('the home list follows Herdr\'s worktree groups', () => {
  const st = snapshot()
  const live = new Set(st.panes.map(p => p.id))
  const s = boardSections(spaceRows(st), st.workspaces, [links()], live)

  it('the coordinators: by role, one row each, at the top', () => {
    expect(s.coordinators.map(c => [c.level, c.row.key])).toEqual([['top', 'w1:p1']])
    expect(s.projects[0]!.coordinator?.key).toBe('w1:p2')
  })

  it('the repo space heads its group, the task agents under it, most urgent first', () => {
    expect(s.projects).toHaveLength(1)
    const g = s.projects[0]!
    expect(g).toMatchObject({ id: REPO_KEY, repo: 'app', key: 'APP', info: { branch: 'main', behind: 38 }, remote: null })
    expect(g.space?.key).toBe('w2:p1')
    // Waiting on you first (APP-1's reviewer, APP-2), then APP-1's worker at work.
    expect(g.members.map(m => [m.row.key, m.task?.key ?? null, m.role])).toEqual([
      ['w3:p9', 'APP-1', 'reviewer'], ['w4:p1', 'APP-2', 'worker'], ['w3:p1', 'APP-1', 'worker'],
    ])
    // The project coordinator counts too (at work).
    expect(g.sum).toEqual({ blocked: 2, working: 2, ready: 0, total: 4 })
    expect(g.state).toBe('blocked')
  })

  it('a worker and its reviewer in one space: one row each, opening its own pane', () => {
    const g = s.projects[0]!
    const app1 = g.members.filter(m => m.task?.id === 'app/1')
    expect(app1.map(m => [m.row.kind, m.row.lead.id, memberTag(m, 'review')])).toEqual([['pane', 'w3:p9', 'APP-1 · review'], ['pane', 'w3:p1', 'APP-1']])
  })

  it('spaces that are not the board\'s stay as they were, worktrees of the repo included', () => {
    expect(s.others.map(r => r.key)).toEqual(['w5:p1', 'w6:p1'])
  })

  it('without the board, nothing is grouped: Herdr\'s worktree group stays in the usual lists', () => {
    const bare = boardSections(spaceRows(st), st.workspaces, [], live)
    expect(bare.coordinators).toEqual([])
    expect(bare.projects).toEqual([])
    expect(bare.others.map(r => r.key)).toEqual(spaceRows(st).map(r => r.key))
  })

  it('a repo on two machines: each group shows its own machine\'s checkout', () => {
    const remote = snapshot('abcd1234')
    const remoteLinks: MachineLinks = {
      machine: 'abcd1234', coordinators: [],
      tasks: tasksFromFiles([linksFromTaskFile({ id: 'app/9', title: 'Far', link: { pane: 'w4:p1', workspace: 'w4', ownsWorkspace: true } }, () => 'abcd1234')!], {}),
      repos: [{ repo: 'app', root: '/home/u/dev/app', branch: 'remote-feature', behind: 1 }],
    }
    const both = [links(), remoteLinks]
    const all = new Set([...live, ...remote.panes.map(p => p.id)])
    const far = boardSections(spaceRows(remote, 'abcd1234'), [...st.workspaces, ...remote.workspaces], both, all).projects[0]!
    expect(far.info).toMatchObject({ branch: 'remote-feature', behind: 1 })
    expect(far.space?.key).toBe('abcd1234~w2:p1')
    expect(far.members.map(m => m.task?.key)).toEqual(['#9'])
    const near = boardSections(spaceRows(st, ''), [...st.workspaces, ...remote.workspaces], both, all).projects[0]!
    expect(near.info).toMatchObject({ branch: 'main', behind: 38 })
    // A named session of a machine reads that machine's board.
    const session = boardSections(spaceRows(remote, 'abcd1234'), remote.workspaces, both, all, k => (k === 'abcd1234' ? 'abcd1234' : k)).projects[0]!
    expect(session.info?.branch).toBe('remote-feature')
  })

  it('a repo coordinated from another machine: its tasks stay here, with the link', () => {
    const far: MachineLinks = { machine: '0a1b2c3d', tasks: [], coordinators: [{ level: 'project', repo: 'app', pane: '0a1b2c3d~w1:p4', workspace: null }] }
    const here = { ...links(), coordinators: links().coordinators.filter(c => c.level === 'top') }
    const g = boardSections(spaceRows(st), st.workspaces, [here, far], new Set([...live, '0a1b2c3d~w1:p4'])).projects[0]!
    expect(g.coordinator).toBeNull()
    expect(g.remote).toEqual({ pane: '0a1b2c3d~w1:p4', machine: '0a1b2c3d' })
    // Its pane gone from Herdr: no link.
    expect(boardSections(spaceRows(st), st.workspaces, [here, far], live).projects[0]!.remote).toBeNull()
  })

  it('closing the repo space: the tasks whose agents stop with it', () => {
    expect(tasksIn(['w2', 'w3', 'w4', 'w6'], st.panes, [links()]).map(t => t.key)).toEqual(['APP-2', 'APP-1'])
    expect(tasksIn(['w5'], st.panes, [links()])).toEqual([])
  })
})

describe('labels', () => {
  it('a member\'s tag', () => {
    const task = links().tasks[0]!
    expect(memberTag({ task, role: 'worker' }, 'review')).toBe(task.key)
    expect(memberTag({ task, role: 'reviewer' }, 'review')).toBe(`${task.key} · review`)
    expect(memberTag({ task, role: 'attempt', letter: 'B' }, 'review')).toBe(`${task.key} · B`)
    expect(memberTag({ task: null, role: 'worker' }, 'review')).toBe('')
  })
  it('elapsed time', () => {
    expect(elapsedLabel(45_000)).toBe('45s')
    expect(elapsedLabel(17 * 60_000)).toBe('17m')
    expect(elapsedLabel(125 * 60_000)).toBe('2h05')
    expect(elapsedLabel(3 * 86_400_000)).toBe('3d')
    expect(elapsedLabel(-5)).toBe('0s')
  })
})

describe('closing what holds a task', () => {
  const st = snapshot()
  const all = links()
  it('the repo space closes its worktree group: every task in it is named', async () => {
    const { planClose, tasksClosing, taskStopMessage } = await import('../app/utils/closeFlow')
    const plan = planClose(st, 'workspace', 'w2')
    expect(plan.group).toBe(true)
    const tasks = tasksClosing(plan, 'workspace', [all])
    expect(tasks.map(t => t.key).sort()).toEqual(['APP-1', 'APP-2'])
    const en = (a: string) => a
    expect(taskStopMessage(tasks, en)?.action).toBe('Close and stop 2 tasks')
    expect(taskStopMessage(tasks, en)?.message).toContain('APP-1 Login redirect')
  })
  it('a task\'s own space, or its agent\'s pane, names that task; a shell elsewhere names none', async () => {
    const { planClose, tasksClosing, taskStopMessage } = await import('../app/utils/closeFlow')
    expect(tasksClosing(planClose(st, 'workspace', 'w4'), 'workspace', [all]).map(t => t.key)).toEqual(['APP-2'])
    expect(tasksClosing(planClose(st, 'pane', 'w3:p9'), 'pane', [all]).map(t => t.key)).toEqual(['APP-1'])
    expect(tasksClosing(planClose(st, 'workspace', 'w5'), 'workspace', [all])).toEqual([])
    expect(taskStopMessage([], (a: string) => a)).toBeNull()
    expect(taskStopMessage([{ key: 'APP-2', title: '' }], (a: string) => a)?.action).toBe('Close and stop the task')
  })
})
