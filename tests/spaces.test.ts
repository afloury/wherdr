import { describe, expect, it } from 'vitest'
import { reduceSnapshot } from '../server/utils/snapshot'
import { isShellRow, leadPane, mirrorInput, mirrorSize, projectRoots, rememberTab, repoRoots, rowGroup, spaceRows, spaceTab } from '../shared/spaces'
import { groupByProject, leadByCoordinator, projectCounts, projectSections, remoteCoordinator, stateSource, tabStates, waitingTab } from '../shared/projects'
import type { Pane } from '../shared/types'
import layouts from './fixtures/snapshot-layouts.json'

// Fixture: w1 = "herdr-web", tabs dev (3 panes) + server (1 pane);
// w2 = "api", 1 tab with 2 panes; w3 = "notes", 1 tab with one pane.
const pane = (id: string, tab: string, agent: string | null = null, status = 'idle') => ({
  pane_id: id, workspace_id: tab.split(':')[0], tab_id: tab, agent, agent_status: agent ? status : 'unknown',
})
const snap = (list: ReturnType<typeof pane>[]) => reduceSnapshot({ ...layouts, panes: list })
const base = [
  pane('w1:p1', 'w1:t1', 'claude', 'working'), pane('w1:p2', 'w1:t1', 'codex', 'done'), pane('w1:p3', 'w1:t1'),
  pane('w1:p4', 'w1:t2', 'claude', 'blocked'),
  pane('w2:p1', 'w2:t1'), pane('w2:p2', 'w2:t1'),
  pane('w3:p1', 'w3:t1', 'claude', 'idle'),
]

describe('state of a space = its most urgent pane', () => {
  it('your turn > working > unread > ready > terminal', () => {
    const st = (agent: string | null, status: Pane['status']) => ({ agent, status })
    expect(leadPane([st('claude', 'idle'), st('codex', 'working'), st('claude', 'blocked')])).toEqual(st('claude', 'blocked'))
    expect(leadPane([st(null, null), st('claude', 'done'), st('codex', 'idle')])).toEqual(st('claude', 'done'))
    expect(leadPane([st(null, null), st('claude', 'unknown')])).toEqual(st('claude', 'unknown'))
    expect(leadPane([])).toBeNull()
  })

  it('one row per space; 1 tab + 1 pane = the agent card', () => {
    const rows = spaceRows(snap(base))
    expect(rows.map(r => [r.kind, r.key])).toEqual([['space', 'w1'], ['space', 'w2'], ['pane', 'w3:p1']])
    const w1 = rows[0]!
    if (w1.kind !== 'space') throw new Error('space attendu')
    // The "your turn" pane of the server tab wins over the dev tab.
    expect(w1.lead.id).toBe('w1:p4')
    expect(w1.leadTab.tab.id).toBe('w1:t2')
    expect(w1.tabs).toHaveLength(2)
    expect(w1.panes).toHaveLength(4)
    expect(w1.sum).toEqual({ blocked: 1, working: 1, done: 1, agents: 3 })
    // The shell space (w2) is sorted as an idle space.
    expect(rows.map(rowGroup)).toEqual(['blocked', 'ready', 'ready'])
    expect(rows.map(isShellRow)).toEqual([false, true, false])
  })

  it('on a tie, the first in reading order', () => {
    const rows = spaceRows(snap([pane('w1:p1', 'w1:t1', 'claude', 'working'), pane('w1:p2', 'w1:t1', 'codex', 'working'), pane('w1:p4', 'w1:t2', 'claude', 'working')]))
    expect(rows[0]!.lead.id).toBe('w1:p1')
    expect(rowGroup(rows[0]!)).toBe('working')
  })

  it('filtre par machine', () => {
    const remote = reduceSnapshot({ ...layouts, panes: base }, 'abcd1234')
    const local = snap(base)
    const both = { workspaces: [...local.workspaces, ...remote.workspaces], tabs: [...local.tabs!, ...remote.tabs!], panes: [...local.panes, ...remote.panes] }
    expect(spaceRows(both, 'abcd1234').map(r => r.key)).toEqual(['abcd1234~w1', 'abcd1234~w2', 'abcd1234~w3:p1'])
    expect(spaceRows(both, '')).toHaveLength(3)
  })
})

describe('root terminal of a worktree group', () => {
  // Herdr: main checkout (w1, a shell), two thread worktrees
  // (w2, w3), a shell elsewhere (w4), an agent on the checkout (w5).
  const REPO = '/home/u/code/app/.git'
  const tree = (checkout: string, linked: boolean, repo = REPO) => ({ checkout_path: checkout, is_linked_worktree: linked, repo_key: repo, repo_name: 'app', repo_root: '/home/u/code/app' })
  const one = (ws: string, cwd: string, agent: string | null = null, extra: object = {}) => ({
    pane_id: `${ws}:p1`, workspace_id: ws, tab_id: `${ws}:t1`, agent, agent_status: agent ? 'idle' : 'unknown', cwd, ...extra,
  })
  const hp = { tokens: { hp_project: 'demo' } }
  const raw = {
    workspaces: [
      { workspace_id: 'w1', label: 'app', number: 1, worktree: tree('/home/u/code/app', false) },
      { workspace_id: 'w2', label: 'Thread 1', number: 2, worktree: tree('/home/u/.herdr/worktrees/app/hp-demo-t-0001-a', true) },
      { workspace_id: 'w3', label: 'Thread 2', number: 3, worktree: tree('/home/u/.herdr/worktrees/app/hp-demo-t-0002-b', true) },
      { workspace_id: 'w4', label: 'home', number: 4 },
      { workspace_id: 'w5', label: 'app', number: 5, worktree: tree('/home/u/code/app', false) },
    ],
    tabs: ['w1', 'w2', 'w3', 'w4', 'w5'].map((w, i) => ({ tab_id: `${w}:t1`, workspace_id: w, label: '1', number: i + 1 })),
    panes: [
      one('w1', '/home/u/code/app'),
      one('w2', '/home/u/.herdr/worktrees/app/hp-demo-t-0001-a', 'claude', hp),
      one('w3', '/home/u/.herdr/worktrees/app/hp-demo-t-0002-b', 'codex', hp),
      one('w4', '/home/u'),
      one('w5', '/home/u/code/app', 'claude'),
    ],
  }

  it('the shell of the main checkout, with its open worktrees', () => {
    const st = reduceSnapshot(raw)
    expect(st.workspaces[0]).toMatchObject({ repo: REPO, repoName: 'app', worktree: false })
    expect(st.workspaces[3]!.repo).toBeUndefined()
    const roots = repoRoots(st, spaceRows(st))
    expect(roots.map(r => [r.row.key, r.name, r.worktrees])).toEqual([['w1:p1', 'app', ['w2', 'w3']]])
    // Attached to the project whose threads are these worktrees.
    const { projects } = groupByProject(st.panes.filter(p => p.agent))
    expect(projects.map(g => [g.key, projectRoots(roots, g.panes).map(r => r.name)])).toEqual([['demo', ['app']]])
    expect(projectRoots(roots, [{ workspace: 'w4' }])).toEqual([])
  })

  it('no root without an open worktree, nor for an agent or another repository', () => {
    const alone = reduceSnapshot({ ...raw, workspaces: raw.workspaces.filter(w => w.workspace_id !== 'w2' && w.workspace_id !== 'w3'), panes: raw.panes.filter(p => p.workspace_id !== 'w2' && p.workspace_id !== 'w3') })
    expect(repoRoots(alone, spaceRows(alone))).toEqual([])
    const other = reduceSnapshot({ ...raw, workspaces: raw.workspaces.map(w => (w.workspace_id === 'w1' ? { ...w, worktree: tree('/home/u/code/app', false, '/x/.git') } : w)) })
    expect(repoRoots(other, spaceRows(other))).toEqual([])
  })

  it('same machine only', () => {
    const local = reduceSnapshot(raw)
    const remote = reduceSnapshot({ ...raw, workspaces: raw.workspaces.filter(w => w.workspace_id !== 'w1'), panes: raw.panes.filter(p => p.workspace_id !== 'w1') }, 'abcd1234')
    const lone = reduceSnapshot({ ...raw, workspaces: raw.workspaces.filter(w => w.workspace_id === 'w1'), panes: raw.panes.filter(p => p.workspace_id === 'w1') })
    const both = { workspaces: [...lone.workspaces, ...remote.workspaces], panes: [...lone.panes, ...remote.panes], tabs: [...lone.tabs!, ...remote.tabs!] }
    expect(repoRoots(both, spaceRows(both, ''))).toEqual([])
    expect(repoRoots(local, spaceRows(local, ''))).toHaveLength(1)
  })

  it('three shells at the root: a single header, the others stay terminals', () => {
    // herdr-projects opened two more shells at the root (w6, w7); w1 has the lowest number.
    const extra = { ...raw,
      workspaces: [
        { workspace_id: 'w6', label: 'app', number: 6, worktree: tree('/home/u/code/app', false) },
        ...raw.workspaces,
        { workspace_id: 'w7', label: 'app', number: 7, worktree: tree('/home/u/code/app', false) },
      ],
      tabs: [...raw.tabs, ...['w6', 'w7'].map((w, i) => ({ tab_id: `${w}:t1`, workspace_id: w, label: '1', number: 6 + i }))],
      panes: [one('w6', '/home/u/code/app'), ...raw.panes, one('w7', '/home/u/code/app')],
    }
    const st = reduceSnapshot(extra)
    const rows = spaceRows(st)
    const roots = repoRoots(st, rows)
    expect(roots.map(r => [r.row.key, r.worktrees])).toEqual([['w1:p1', ['w2', 'w3']]])
    // The two others are ordinary shells, sorted in Ready.
    const header = new Set(roots.map(r => r.row.key))
    const shells = rows.filter(r => isShellRow(r) && !header.has(r.key))
    expect(shells.map(r => [r.key, rowGroup(r)])).toEqual([['w4:p1', 'ready'], ['w6:p1', 'ready'], ['w7:p1', 'ready']])
    // Herdr does not give the repository of some shells: same rule.
    const mixed = reduceSnapshot({ ...extra, workspaces: extra.workspaces.map(({ worktree, ...w }) => (w.workspace_id === 'w6' ? w : { ...w, worktree })) })
    expect(repoRoots(mixed, spaceRows(mixed)).map(r => r.row.key)).toEqual(['w1:p1'])
    // Without a known repository (folder only): same rule.
    const bare = reduceSnapshot({ ...extra, workspaces: extra.workspaces.map(({ worktree: _w, ...w }) => w) })
    expect(repoRoots(bare, spaceRows(bare)).map(r => r.row.key)).toEqual(['w1:p1'])
  })

  it('the counter only counts the open worktrees of this repository', () => {
    // Thread 2 closed (missing from the snapshot); a worktree of another repository open.
    const st = reduceSnapshot({ ...raw,
      workspaces: [...raw.workspaces.filter(w => w.workspace_id !== 'w3'),
        { workspace_id: 'w8', label: 'Autre', number: 8, worktree: { ...tree('/home/u/.herdr/worktrees/lib/x', true, '/home/u/code/lib/.git'), repo_name: 'lib' } }],
      panes: [...raw.panes.filter(p => p.workspace_id !== 'w3'), one('w8', '/home/u/.herdr/worktrees/lib/x', 'codex')],
    })
    expect(repoRoots(st, spaceRows(st)).map(r => [r.name, r.worktrees.length])).toEqual([['app', 1]])
  })

  it('Herdr without repository in the snapshot: herdr-projects worktrees folder', () => {
    const bare = reduceSnapshot({ ...raw, workspaces: raw.workspaces.map(({ worktree: _w, ...w }) => w) })
    expect(repoRoots(bare, spaceRows(bare)).map(r => [r.row.key, r.worktrees])).toEqual([['w1:p1', ['w2', 'w3']]])
    // A shell in another folder is not a root.
    const elsewhere = reduceSnapshot({ ...raw, workspaces: raw.workspaces.map(({ worktree: _w, ...w }) => w), panes: raw.panes.map(p => (p.workspace_id === 'w1' ? { ...p, cwd: '/home/u/code/other' } : p)) })
    expect(repoRoots(elsewhere, spaceRows(elsewhere))).toEqual([])
  })
})

describe('tab remembered per space', () => {
  const rows = spaceRows(snap(base))
  const w1 = rows[0]!
  if (w1.kind !== 'space') throw new Error('space attendu')

  it('reopens the last tab, otherwise that of the most urgent pane', () => {
    expect(spaceTab(w1.tabs, {}, 'w1')).toBe('w1:t2')
    expect(spaceTab(w1.tabs, { w1: 'w1:t1' }, 'w1')).toBe('w1:t1')
    // Tab closed since: back to the most urgent.
    expect(spaceTab(w1.tabs, { w1: 'w1:t9' }, 'w1')).toBe('w1:t2')
    expect(spaceTab([], {}, 'w1')).toBeNull()
  })

  it('remembers and forgets closed spaces', () => {
    expect(rememberTab({ w1: 'w1:t1' }, 'w2', 'w2:t1')).toEqual({ w1: 'w1:t1', w2: 'w2:t1' })
    expect(rememberTab({ w1: 'w1:t1', w9: 'w9:t1' }, 'w1', 'w1:t2', ['w1', 'w2'])).toEqual({ w1: 'w1:t2' })
  })
})

describe('projets et machines', () => {
  let n = 0
  const p = (o: Partial<Pane>): Pane => ({
    id: `w${++n}:p1`, workspace: `w${n}`, tab: `w${n}:t1`, tabLabel: null, agent: 'claude', name: null, label: null,
    status: 'idle', title: 'Claude', cwd: '/home/u', agentSession: null, ...o,
  })
  const coordPi = p({ cwd: '/home/user/.herdr-projects/wherdr' })
  const tPi = p({ name: 'hp-wherdr-t-0040-quota', cwd: '/home/user/.herdr/worktrees/herdr-web/hp-wherdr-t-0040-quota' })
  const tMac = p({ machine: 'a1b2c3d4', id: 'a1b2c3d4~w1:p1', name: 'hp-wherdr-t-0041-spaces', cwd: '/Users/a/.herdr/worktrees/herdr-web/hp-wherdr-t-0041-spaces' })
  const all = [coordPi, tPi, tMac]

  it('threads stay under their machine', () => {
    const pi = groupByProject(all.filter(x => !x.machine)).projects
    const mac = groupByProject(all.filter(x => x.machine === 'a1b2c3d4')).projects
    expect(pi[0]!.panes).toEqual([coordPi, tPi])
    expect(mac[0]!.panes).toEqual([tMac])
  })

  it('block of another machine: coordinated from the coordinator\'s', () => {
    const mac = groupByProject([tMac]).projects[0]!
    expect(remoteCoordinator(mac, all, 'a1b2c3d4')).toBe(coordPi)
    // On the coordinator's machine: it is already at the top of the block.
    const pi = groupByProject([coordPi, tPi]).projects[0]!
    expect(remoteCoordinator(pi, all, '')).toBeNull()
    // No coordinator open anywhere: nothing.
    expect(remoteCoordinator(mac, [tPi, tMac], 'a1b2c3d4')).toBeNull()
  })

  // Real-world shape: the coordinator's space (w1) holds a thread opened as a
  // tab (`--kind tab`, same folder, working), a worktree thread has its own space (w2).
  const tabbed = () => {
    const st = snap([
      { ...pane('w1:p1', 'w1:t1', 'claude', 'idle'), cwd: '/home/user/.herdr-projects/demo', tokens: { hp_group: 'demo!0!w1:p1', hp_rank: 5 } },
      { ...pane('w1:p4', 'w1:t2', 'codex', 'working'), cwd: '/home/user/.herdr-projects/demo', tokens: { hp_group: 'demo!1!2!t-0008' } },
      { ...pane('w2:p1', 'w2:t1', 'claude', 'working'), cwd: '/home/user/.herdr/worktrees/app/hp-demo-t-0007-fix', tokens: { hp_group: 'demo!1!4!t-0007' } },
      { ...pane('w2:p2', 'w2:t1'), cwd: '/home/user/.herdr/worktrees/app/hp-demo-t-0007-fix' },
    ])
    return leadByCoordinator(spaceRows(st))
  }

  it('a thread opened as a tab stays a tab of the coordinator\'s single card', () => {
    const rows = tabbed()
    expect(rows.map(r => [r.kind, r.key, r.lead.id])).toEqual([['space', 'w1', 'w1:p1'], ['space', 'w2', 'w2:p1']])
    const [coord] = rows
    if (coord?.kind !== 'space') throw new Error('space expected')
    // All tabs stay in the card; the coordinator's tab represents it, even
    // though the working thread tab is more urgent.
    expect([coord.tabs.map(e => e.tab.id), coord.leadTab.tab.id]).toEqual([['w1:t1', 'w1:t2'], 'w1:t1'])
    expect(rowGroup(coord)).toBe('ready')
    const g = groupByProject(rows.filter(r => r.lead.agent).map(r => r.lead)).projects[0]!
    expect(g.coordinator?.id).toBe('w1:p1')
    expect(g.panes.map(p => p.id)).toEqual(['w1:p1', 'w2:p1'])
    const s = projectSections(g, [])
    expect(s.coordinator?.id).toBe('w1:p1')
    expect([...s.repos.flatMap(r => r.panes), ...s.others].map(p => p.id)).toEqual(['w2:p1'])
    // Opening the card: the coordinator's tab, unless another one was opened last.
    expect(spaceTab(coord.tabs, {}, 'w1', coord.leadTab.tab.id)).toBe('w1:t1')
    expect(spaceTab(coord.tabs, { w1: 'w1:t2' }, 'w1', coord.leadTab.tab.id)).toBe('w1:t2')
  })

  it('spaces without a coordinator keep their most urgent pane as lead', () => {
    const plain = spaceRows(snap(base))
    expect(leadByCoordinator(plain)).toEqual(plain)
    // Worktree thread with a shell tab: the thread represents its space.
    const wt = snap([
      { ...pane('w1:p1', 'w1:t1', 'claude', 'working'), name: 'hp-demo-t-0007-fix' },
      { ...pane('w1:p4', 'w1:t2') },
    ])
    expect(leadByCoordinator(spaceRows(wt)).map(r => [r.key, r.lead.id])).toEqual([['w1', 'w1:p1']])
  })

  it('the coordinator card shows its most urgent tab\'s state without moving', () => {
    const rows = tabbed()
    const coord = rows[0]!
    if (coord.kind !== 'space') throw new Error('space expected')
    expect([coord.lead.id, coord.state?.id, stateSource(coord)]).toEqual(['w1:p1', 'w1:p4', 'T-0008'])
    expect(tabStates(coord)).toEqual(['idle', 'working'])
    // Still in Ready and first of its project: the state does not move it.
    expect(rowGroup(coord)).toBe('ready')
    // Only a tab waiting for the user is opened directly.
    expect(waitingTab(coord)).toBeNull()
    const g = groupByProject(rows.filter(r => r.lead.agent).map(r => r.lead)).projects[0]!
    const rowOf = (p: Pane) => rows.find(r => r.lead.id === p.id)
    // Coordinator ready + thread tab working + worktree thread working.
    expect(projectCounts(g.panes, rowOf)).toEqual({ total: 3, blocked: 0, working: 2, ready: 1 })
    expect(projectCounts(g.panes)).toEqual({ total: 2, blocked: 0, working: 1, ready: 1 })
  })

  it('a blocked thread tab: your turn on the card, a tap opens that tab', () => {
    const st = snap([
      { ...pane('w1:p1', 'w1:t1', 'claude', 'working'), cwd: '/home/user/.herdr-projects/demo', tokens: { hp_group: 'demo!0!w1:p1' } },
      { ...pane('w1:p4', 'w1:t2', 'codex', 'blocked'), cwd: '/home/user/.herdr-projects/demo' },
    ])
    const [coord] = leadByCoordinator(spaceRows(st))
    if (coord?.kind !== 'space') throw new Error('space expected')
    expect([coord.lead.id, coord.state?.status, waitingTab(coord)]).toEqual(['w1:p1', 'blocked', 'w1:t2'])
    // No thread number: the tab's label.
    expect(stateSource(coord)).toBe(coord.tabs[1]!.tab.label || String(coord.tabs[1]!.tab.number))
    expect(rowGroup(coord)).toBe('working')
    const g = groupByProject([coord.lead]).projects[0]!
    expect(projectCounts(g.panes, () => coord)).toEqual({ total: 2, blocked: 1, working: 1, ready: 0 })
  })

  it('no state override when the coordinator is the most urgent', () => {
    const st = snap([
      { ...pane('w1:p1', 'w1:t1', 'claude', 'blocked'), cwd: '/home/user/.herdr-projects/demo', tokens: { hp_group: 'demo!0!w1:p1' } },
      { ...pane('w1:p4', 'w1:t2', 'codex', 'working'), cwd: '/home/user/.herdr-projects/demo', tokens: { hp_group: 'demo!1!2!t-0008' } },
    ])
    const [coord] = leadByCoordinator(spaceRows(st))
    if (coord?.kind !== 'space') throw new Error('space expected')
    expect([coord.lead.id, coord.state, stateSource(coord), waitingTab(coord)]).toEqual(['w1:p1', undefined, null, null])
    expect(tabStates(coord)).toEqual(['blocked', 'working'])
  })
})

describe('terminal mirror', () => {
  it('size: rows of the real terminal, width overestimated', () => {
    const rule = '─'.repeat(98)
    expect(mirrorSize({ rows: 50, text: `❯ ls\n${rule}\nok   `, rect: { width: 60, height: 40 } })).toEqual({ cols: 98, rows: 50 })
    expect(mirrorSize({ rows: 30, text: 'court', rect: { width: 60, height: 40 } })).toEqual({ cols: 60, rows: 30 })
    expect(mirrorSize({ text: '', rect: null })).toEqual({ cols: 20, rows: 24 })
    expect(mirrorSize({ rows: 900, text: 'x'.repeat(999) })).toEqual({ cols: 300, rows: 200 })
  })

  it('keystrokes: text, named keys, unknown sequences ignored', () => {
    expect(mirrorInput('ls')).toEqual([{ text: 'ls' }])
    expect(mirrorInput('\r')).toEqual([{ keys: ['enter'] }])
    expect(mirrorInput('\x1b[A\x1b[B')).toEqual([{ keys: ['up', 'down'] }])
    expect(mirrorInput('\x03')).toEqual([{ keys: ['ctrl+c'] }])
    expect(mirrorInput('\x1b')).toEqual([{ keys: ['esc'] }])
    expect(mirrorInput('\x1bb')).toEqual([{ keys: ['alt+b'] }])
    expect(mirrorInput('\x1b[H\x1b[F\x1b[3~')).toEqual([{ keys: ['home', 'end', 'delete'] }])
    expect(mirrorInput('\x1b[1~\x1b[4~\x1bOH\x1bOF')).toEqual([{ keys: ['home', 'end', 'home', 'end'] }])
    expect(mirrorInput('\x1b[5~\x1b[6~\x1b[2~')).toEqual([{ keys: ['pageup', 'pagedown', 'insert'] }])
    expect(mirrorInput('\x1b[Z')).toEqual([{ keys: ['shift+tab'] }])
    expect(mirrorInput('a\x7fb')).toEqual([{ text: 'a' }, { keys: ['backspace'] }, { text: 'b' }])
    expect(mirrorInput('\x1b[3~x')).toEqual([{ keys: ['delete'] }, { text: 'x' }])
    expect(mirrorInput('un\ndeux\r\n')).toEqual([{ text: 'un\ndeux\n' }])
  })

  it('bracketed paste: text, not Enters', () => {
    expect(mirrorInput('\x1b[200~un\rdeux\x1b[201~')).toEqual([{ text: 'un\ndeux' }])
    expect(mirrorInput('\x1b[200~a\tb\x1b[201~')).toEqual([{ text: 'a\tb' }])
    expect(mirrorInput('\x1b[200~\x1b[201~')).toEqual([])
  })
})
