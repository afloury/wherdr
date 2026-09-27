import { describe, expect, it } from 'vitest'
import type { Pane } from '../shared/types'
import { groupByProject, projectOf, projectSections, projectToken, threadNumber } from '../shared/projects'
import type { RepoRoot } from '../shared/spaces'

let n = 0
const pane = (overrides: Partial<Pane> = {}): Pane => ({
  id: `w${++n}:p1`, workspace: `w${n}`, tab: `w${n}:t1`, tabLabel: null,
  agent: 'claude', name: null, label: null, status: 'idle',
  title: 'Claude', cwd: '/home/user/code', agentSession: null,
  ...overrides,
})
const coord = (slug: string, o: Partial<Pane> = {}) => pane({ cwd: `/home/user/.herdr-projects/${slug}`, ...o })
const thread = (slug: string, num: string, o: Partial<Pane> = {}) =>
  pane({ name: `hp-${slug}-t-${num}-sujet`, cwd: `/home/user/.herdr/worktrees/repo/hp-${slug}-t-${num}-sujet`, ...o })

describe('projet d’un pane', () => {
  it('préfère le jeton de Herdr, puis le nom, puis le dossier', () => {
    expect(projectOf(pane({ project: 'wherdr', cwd: '/tmp' }))).toBe('wherdr')
    expect(projectOf(pane({ name: 'hp-mon-app-t-0003-x' }))).toBe('mon-app')
    expect(projectOf(pane({ cwd: '/Users/a/.herdr/worktrees/herdr-web/hp-wherdr-t-0018-regroupement' }))).toBe('wherdr')
    expect(projectOf(pane({ cwd: '/home/user/.herdr-projects/wherdr' }))).toBe('wherdr')
    expect(projectOf(pane({ cwd: '/home/user/.herdr-projects/wherdr/threads/t-0002' }))).toBe('wherdr')
    expect(projectOf(pane({ cwd: '/home/user/code/app', name: 'claude' }))).toBeNull()
  })

  it('numérote les threads, pas le coordinateur', () => {
    expect(threadNumber(thread('wherdr', '0018'))).toBe(18)
    expect(threadNumber(pane({ cwd: '/Users/a/.herdr/worktrees/r/hp-wherdr-t-0007' }))).toBe(7)
    expect(threadNumber(coord('wherdr'))).toBeNull()
  })
})

describe('regroupement par projet', () => {
  it('met le coordinateur en premier, puis les threads par numéro', () => {
    const t12 = thread('wherdr', '0012', { status: 'working' })
    const c = coord('wherdr')
    const t5 = thread('wherdr', '0005', { status: 'blocked' })
    const other = pane({ title: 'Hors projet' })
    const { projects, others } = groupByProject([t12, other, c, t5])
    expect(projects).toHaveLength(1)
    expect(projects[0]!.name).toBe('wherdr')
    expect(projects[0]!.coordinator).toBe(c)
    expect(projects[0]!.panes).toEqual([c, t5, t12])
    expect(projects[0]!.blocked).toBe(1)
    expect(projects[0]!.working).toBe(1)
    expect(others).toEqual([other])
  })

  it('sépare les projets, triés par nom, et garde l’ordre des agents hors projet', () => {
    const a = pane({ title: 'A' })
    const b = pane({ title: 'B' })
    const { projects, others } = groupByProject([thread('zeta', '0001'), a, coord('alpha'), b, pane({ project: 'Zeta' })])
    expect(projects.map(p => p.key)).toEqual(['alpha', 'zeta'])
    expect(projects[1]!.panes).toHaveLength(2)
    expect(projects[1]!.coordinator?.project).toBe('Zeta')
    expect(others).toEqual([a, b])
  })

  it('accepte un projet sans coordinateur visible (threads d’une autre machine)', () => {
    const { projects } = groupByProject([thread('wherdr', '0018')])
    expect(projects[0]!.coordinator).toBeNull()
    expect(projects[0]!.panes).toHaveLength(1)
  })

  it('ne regroupe rien sans projet', () => {
    const list = [pane(), pane({ agent: 'codex' })]
    expect(groupByProject(list)).toEqual({ projects: [], others: list })
  })
})

describe('sous-groupes de dépôt', () => {
  it('place le coordinateur, chaque dépôt et les autres spaces séparément, triés par urgence', () => {
    const c = coord('wherdr', { status: 'idle' })
    const aReady = thread('wherdr', '0001', { workspace: 'a1', status: 'idle' })
    const aBlocked = thread('wherdr', '0002', { workspace: 'a2', status: 'blocked' })
    const bWorking = thread('wherdr', '0003', { workspace: 'b1', cwd: '/home/user/.herdr/worktrees/second/hp-wherdr-t-0003', status: 'working' })
    const other = pane({ project: 'wherdr', cwd: '/home/user/.herdr-projects/wherdr/notes', status: 'blocked' })
    const root = { name: 'repo', worktrees: ['a1', 'a2'], row: { key: 'root', kind: 'pane', pane: pane({ agent: null }), lead: pane({ agent: null, cwd: '/home/user/code/repo' }) } } as RepoRoot
    const group = groupByProject([aReady, other, bWorking, c, aBlocked]).projects[0]!
    const sections = projectSections(group, [root])
    expect(sections.coordinator).toBe(c)
    expect(sections.repos.map(r => [r.name, r.panes, r.blocked, r.working])).toEqual([
      ['repo', [aBlocked, aReady], 1, 0],
      ['second', [bWorking], 0, 1],
    ])
    expect(sections.others).toEqual([other])
    expect(group.blocked).toBe(2)
  })

  it('laisse les spaces hors worktree après les dépôts', () => {
    const c = coord('demo')
    const other = pane({ project: 'demo', cwd: '/home/user/.herdr-projects/demo/docs' })
    const group = groupByProject([c, other]).projects[0]!
    expect(projectSections(group, [])).toEqual({ coordinator: c, repos: [], others: [other] })
  })
})

describe('jetons de herdr-projects', () => {
  it('reprend hp_project, sinon hp_group', () => {
    expect(projectToken({ hp_project: 'wherdr', hp_rank: '4' })).toBe('wherdr')
    expect(projectToken({ hp_group: ' autre ' })).toBe('autre')
    expect(projectToken({ hp_rank: '1' })).toBeUndefined()
    expect(projectToken(undefined)).toBeUndefined()
  })

  it('ignore la valeur technique d’un pane détaché (« ~!0003 ») et tout nom non conforme', () => {
    expect(projectToken({ hp_group: '~!0003' })).toBeUndefined()
    expect(projectToken({ hp_project: '~!0006', hp_group: 'wherdr' })).toBe('wherdr')
    expect(projectToken({ hp_project: 'mon projet' })).toBeUndefined()
    // Thread clôturé resté ouvert : retombe sur son nom ou son worktree.
    expect(projectOf(pane({ project: '~!0003', name: 'hp-wherdr-t-0003-sujet' }))).toBe('wherdr')
    expect(projectOf(pane({ project: '~!0006', cwd: '/Users/a/.herdr/worktrees/herdr-web/hp-wherdr-t-0006-x' }))).toBe('wherdr')
    const { projects } = groupByProject([pane({ project: '~!0003', name: 'hp-wherdr-t-0003-sujet' })])
    expect(projects.map(p => p.name)).toEqual(['wherdr'])
  })
})
