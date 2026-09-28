import { describe, expect, it } from 'vitest'
import { reduceSnapshot } from '../server/utils/snapshot'
import { isShellRow, leadPane, mirrorInput, mirrorSize, projectRoots, rememberTab, repoRoots, rowGroup, spaceRows, spaceTab } from '../shared/spaces'
import { groupByProject, remoteCoordinator } from '../shared/projects'
import type { Pane } from '../shared/types'
import layouts from './fixtures/snapshot-layouts.json'

// Fixture : w1 = « herdr-web », onglets dev (3 panes) + serveur (1 pane) ;
// w2 = « api », 1 onglet de 2 panes ; w3 = « notes », 1 onglet d'un pane.
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

describe('état d’un space = son pane le plus urgent', () => {
  it('à toi de jouer > au travail > non lu > prêt > terminal', () => {
    const st = (agent: string | null, status: Pane['status']) => ({ agent, status })
    expect(leadPane([st('claude', 'idle'), st('codex', 'working'), st('claude', 'blocked')])).toEqual(st('claude', 'blocked'))
    expect(leadPane([st(null, null), st('claude', 'done'), st('codex', 'idle')])).toEqual(st('claude', 'done'))
    expect(leadPane([st(null, null), st('claude', 'unknown')])).toEqual(st('claude', 'unknown'))
    expect(leadPane([])).toBeNull()
  })

  it('une ligne par space ; 1 onglet + 1 pane = la carte de l’agent', () => {
    const rows = spaceRows(snap(base))
    expect(rows.map(r => [r.kind, r.key])).toEqual([['space', 'w1'], ['space', 'w2'], ['pane', 'w3:p1']])
    const w1 = rows[0]!
    if (w1.kind !== 'space') throw new Error('space attendu')
    // Le pane « à toi de jouer » de l'onglet serveur l'emporte sur l'onglet dev.
    expect(w1.lead.id).toBe('w1:p4')
    expect(w1.leadTab.tab.id).toBe('w1:t2')
    expect(w1.tabs).toHaveLength(2)
    expect(w1.panes).toHaveLength(4)
    expect(w1.sum).toEqual({ blocked: 1, working: 1, done: 1, agents: 3 })
    // Le space de shell (w2) est rangé comme un space au repos.
    expect(rows.map(rowGroup)).toEqual(['blocked', 'ready', 'ready'])
    expect(rows.map(isShellRow)).toEqual([false, true, false])
  })

  it('à égalité, le premier dans l’ordre de lecture', () => {
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

describe('terminal racine d’un groupe de worktrees', () => {
  // Herdr : checkout principal (w1, un shell), deux worktrees de threads
  // (w2, w3), un shell ailleurs (w4), un agent sur le checkout (w5).
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

  it('le shell du checkout principal, avec ses worktrees ouverts', () => {
    const st = reduceSnapshot(raw)
    expect(st.workspaces[0]).toMatchObject({ repo: REPO, repoName: 'app', worktree: false })
    expect(st.workspaces[3]!.repo).toBeUndefined()
    const roots = repoRoots(st, spaceRows(st))
    expect(roots.map(r => [r.row.key, r.name, r.worktrees])).toEqual([['w1:p1', 'app', ['w2', 'w3']]])
    // Rattaché au projet dont les threads sont ces worktrees.
    const { projects } = groupByProject(st.panes.filter(p => p.agent))
    expect(projects.map(g => [g.key, projectRoots(roots, g.panes).map(r => r.name)])).toEqual([['demo', ['app']]])
    expect(projectRoots(roots, [{ workspace: 'w4' }])).toEqual([])
  })

  it('pas de racine sans worktree ouvert, ni pour un agent ou un autre dépôt', () => {
    const alone = reduceSnapshot({ ...raw, workspaces: raw.workspaces.filter(w => w.workspace_id !== 'w2' && w.workspace_id !== 'w3'), panes: raw.panes.filter(p => p.workspace_id !== 'w2' && p.workspace_id !== 'w3') })
    expect(repoRoots(alone, spaceRows(alone))).toEqual([])
    const other = reduceSnapshot({ ...raw, workspaces: raw.workspaces.map(w => (w.workspace_id === 'w1' ? { ...w, worktree: tree('/home/u/code/app', false, '/x/.git') } : w)) })
    expect(repoRoots(other, spaceRows(other))).toEqual([])
  })

  it('même machine seulement', () => {
    const local = reduceSnapshot(raw)
    const remote = reduceSnapshot({ ...raw, workspaces: raw.workspaces.filter(w => w.workspace_id !== 'w1'), panes: raw.panes.filter(p => p.workspace_id !== 'w1') }, 'abcd1234')
    const lone = reduceSnapshot({ ...raw, workspaces: raw.workspaces.filter(w => w.workspace_id === 'w1'), panes: raw.panes.filter(p => p.workspace_id === 'w1') })
    const both = { workspaces: [...lone.workspaces, ...remote.workspaces], panes: [...lone.panes, ...remote.panes], tabs: [...lone.tabs!, ...remote.tabs!] }
    expect(repoRoots(both, spaceRows(both, ''))).toEqual([])
    expect(repoRoots(local, spaceRows(local, ''))).toHaveLength(1)
  })

  it('trois shells à la racine : un seul en-tête, les autres restent des terminaux', () => {
    // herdr-projects a ouvert deux shells de plus à la racine (w6, w7) ; w1 a le numéro le plus bas.
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
    // Les deux autres sont des shells ordinaires, rangés dans Prêts.
    const header = new Set(roots.map(r => r.row.key))
    const shells = rows.filter(r => isShellRow(r) && !header.has(r.key))
    expect(shells.map(r => [r.key, rowGroup(r)])).toEqual([['w4:p1', 'ready'], ['w6:p1', 'ready'], ['w7:p1', 'ready']])
    // Herdr ne donne pas le dépôt de certains shells : même règle.
    const mixed = reduceSnapshot({ ...extra, workspaces: extra.workspaces.map(({ worktree, ...w }) => (w.workspace_id === 'w6' ? w : { ...w, worktree })) })
    expect(repoRoots(mixed, spaceRows(mixed)).map(r => r.row.key)).toEqual(['w1:p1'])
    // Sans dépôt connu (dossier seulement) : même règle.
    const bare = reduceSnapshot({ ...extra, workspaces: extra.workspaces.map(({ worktree: _w, ...w }) => w) })
    expect(repoRoots(bare, spaceRows(bare)).map(r => r.row.key)).toEqual(['w1:p1'])
  })

  it('le compteur ne compte que les worktrees ouverts de ce dépôt', () => {
    // Thread 2 fermé (absent du snapshot) ; un worktree d'un autre dépôt ouvert.
    const st = reduceSnapshot({ ...raw,
      workspaces: [...raw.workspaces.filter(w => w.workspace_id !== 'w3'),
        { workspace_id: 'w8', label: 'Autre', number: 8, worktree: { ...tree('/home/u/.herdr/worktrees/lib/x', true, '/home/u/code/lib/.git'), repo_name: 'lib' } }],
      panes: [...raw.panes.filter(p => p.workspace_id !== 'w3'), one('w8', '/home/u/.herdr/worktrees/lib/x', 'codex')],
    })
    expect(repoRoots(st, spaceRows(st)).map(r => [r.name, r.worktrees.length])).toEqual([['app', 1]])
  })

  it('Herdr sans dépôt dans le snapshot : dossier des worktrees de herdr-projects', () => {
    const bare = reduceSnapshot({ ...raw, workspaces: raw.workspaces.map(({ worktree: _w, ...w }) => w) })
    expect(repoRoots(bare, spaceRows(bare)).map(r => [r.row.key, r.worktrees])).toEqual([['w1:p1', ['w2', 'w3']]])
    // Un shell dans un autre dossier n'est pas une racine.
    const elsewhere = reduceSnapshot({ ...raw, workspaces: raw.workspaces.map(({ worktree: _w, ...w }) => w), panes: raw.panes.map(p => (p.workspace_id === 'w1' ? { ...p, cwd: '/home/u/code/other' } : p)) })
    expect(repoRoots(elsewhere, spaceRows(elsewhere))).toEqual([])
  })
})

describe('onglet mémorisé par space', () => {
  const rows = spaceRows(snap(base))
  const w1 = rows[0]!
  if (w1.kind !== 'space') throw new Error('space attendu')

  it('rouvre le dernier onglet, sinon celui du pane le plus urgent', () => {
    expect(spaceTab(w1.tabs, {}, 'w1')).toBe('w1:t2')
    expect(spaceTab(w1.tabs, { w1: 'w1:t1' }, 'w1')).toBe('w1:t1')
    // Onglet fermé depuis : retour au plus urgent.
    expect(spaceTab(w1.tabs, { w1: 'w1:t9' }, 'w1')).toBe('w1:t2')
    expect(spaceTab([], {}, 'w1')).toBeNull()
  })

  it('mémorise et oublie les spaces fermés', () => {
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

  it('les threads restent sous leur machine', () => {
    const pi = groupByProject(all.filter(x => !x.machine)).projects
    const mac = groupByProject(all.filter(x => x.machine === 'a1b2c3d4')).projects
    expect(pi[0]!.panes).toEqual([coordPi, tPi])
    expect(mac[0]!.panes).toEqual([tMac])
  })

  it('bloc d’une autre machine : coordonné depuis celle du coordinateur', () => {
    const mac = groupByProject([tMac]).projects[0]!
    expect(remoteCoordinator(mac, all, 'a1b2c3d4')).toBe(coordPi)
    // Sur la machine du coordinateur : il est déjà en tête du bloc.
    const pi = groupByProject([coordPi, tPi]).projects[0]!
    expect(remoteCoordinator(pi, all, '')).toBeNull()
    // Pas de coordinateur ouvert nulle part : rien.
    expect(remoteCoordinator(mac, [tPi, tMac], 'a1b2c3d4')).toBeNull()
  })
})

describe('miroir d’un terminal', () => {
  it('taille : lignes du vrai terminal, largeur estimée par excès', () => {
    const rule = '─'.repeat(98)
    expect(mirrorSize({ rows: 50, text: `❯ ls\n${rule}\nok   `, rect: { width: 60, height: 40 } })).toEqual({ cols: 98, rows: 50 })
    expect(mirrorSize({ rows: 30, text: 'court', rect: { width: 60, height: 40 } })).toEqual({ cols: 60, rows: 30 })
    expect(mirrorSize({ text: '', rect: null })).toEqual({ cols: 20, rows: 24 })
    expect(mirrorSize({ rows: 900, text: 'x'.repeat(999) })).toEqual({ cols: 300, rows: 200 })
  })

  it('frappes : texte, touches nommées, séquences inconnues ignorées', () => {
    expect(mirrorInput('ls')).toEqual([{ text: 'ls' }])
    expect(mirrorInput('\r')).toEqual([{ keys: ['enter'] }])
    expect(mirrorInput('\x1b[A\x1b[B')).toEqual([{ keys: ['up', 'down'] }])
    expect(mirrorInput('\x03')).toEqual([{ keys: ['ctrl+c'] }])
    expect(mirrorInput('\x1b')).toEqual([{ keys: ['esc'] }])
    expect(mirrorInput('\x1bb')).toEqual([{ keys: ['alt+b'] }])
    expect(mirrorInput('\x1b[Z')).toEqual([{ keys: ['shift+tab'] }])
    expect(mirrorInput('a\x7fb')).toEqual([{ text: 'a' }, { keys: ['backspace'] }, { text: 'b' }])
    expect(mirrorInput('\x1b[3~x')).toEqual([{ text: 'x' }])
    expect(mirrorInput('un\ndeux\r\n')).toEqual([{ text: 'un\ndeux\n' }])
  })

  it('collage entre crochets : du texte, pas des Entrée', () => {
    expect(mirrorInput('\x1b[200~un\rdeux\x1b[201~')).toEqual([{ text: 'un\ndeux' }])
    expect(mirrorInput('\x1b[200~a\tb\x1b[201~')).toEqual([{ text: 'a\tb' }])
    expect(mirrorInput('\x1b[200~\x1b[201~')).toEqual([])
  })
})
