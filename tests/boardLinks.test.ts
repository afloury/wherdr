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

  it('the repo space heads its group, the task spaces under it, most urgent first', () => {
    expect(s.projects).toHaveLength(1)
    const g = s.projects[0]!
    expect(g).toMatchObject({ id: REPO_KEY, repo: 'app', key: 'APP', info: { branch: 'main', behind: 38 }, remote: null })
    expect(g.space?.key).toBe('w2:p1')
    // Both wait on you (APP-1's reviewer leads its space: still the task), Herdr's order between them.
    expect(g.members.map(m => [m.row.key, m.task?.key ?? null, m.role])).toEqual([['w3', 'APP-1', 'worker'], ['w4:p1', 'APP-2', 'worker'], ['w6:p1', null, 'worker']])
    expect(g.sum).toEqual({ blocked: 2, working: 1, ready: 1, total: 4 })
    expect(g.state).toBe('blocked')
  })

  it('spaces that are not the board\'s or in a repo group stay as they were', () => {
    expect(s.others.map(r => r.key)).toEqual(['w5:p1'])
  })

  it('without links, Herdr\'s worktree group is still a group; a lone repo shell is not', () => {
    const bare = boardSections(spaceRows(st), st.workspaces, [], live)
    expect(bare.coordinators).toEqual([])
    expect(bare.projects.map(g => [g.repo, g.space?.key, g.members.length])).toEqual([['app', 'w2:p1', 3]])
    const alone = st.workspaces.filter(w => !w.worktree)
    expect(boardSections(spaceRows({ ...st, workspaces: alone }), alone, [], live).projects).toEqual([])
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
