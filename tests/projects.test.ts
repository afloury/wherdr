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

describe('project of a pane', () => {
  it('prefers the Herdr token, then the name, then the folder', () => {
    expect(projectOf(pane({ project: 'wherdr', cwd: '/tmp' }))).toBe('wherdr')
    expect(projectOf(pane({ name: 'hp-mon-app-t-0003-x' }))).toBe('mon-app')
    expect(projectOf(pane({ cwd: '/Users/a/.herdr/worktrees/herdr-web/hp-wherdr-t-0018-regroupement' }))).toBe('wherdr')
    expect(projectOf(pane({ cwd: '/home/user/.herdr-projects/wherdr' }))).toBe('wherdr')
    expect(projectOf(pane({ cwd: '/home/user/.herdr-projects/wherdr/threads/t-0002' }))).toBe('wherdr')
    expect(projectOf(pane({ cwd: '/home/user/code/app', name: 'claude' }))).toBeNull()
  })

  it('numbers threads, not the coordinator', () => {
    expect(threadNumber(thread('wherdr', '0018'))).toBe(18)
    expect(threadNumber(pane({ cwd: '/Users/a/.herdr/worktrees/r/hp-wherdr-t-0007' }))).toBe(7)
    expect(threadNumber(coord('wherdr'))).toBeNull()
  })
})

describe('regroupement par projet', () => {
  it('puts the coordinator first, then threads by number', () => {
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

  it('separates projects, sorted by name, and keeps the order of agents outside projects', () => {
    const a = pane({ title: 'A' })
    const b = pane({ title: 'B' })
    const { projects, others } = groupByProject([thread('zeta', '0001'), a, coord('alpha'), b, pane({ project: 'Zeta' })])
    expect(projects.map(p => p.key)).toEqual(['alpha', 'zeta'])
    expect(projects[1]!.panes).toHaveLength(2)
    expect(projects[1]!.coordinator?.project).toBe('Zeta')
    expect(others).toEqual([a, b])
  })

  it('accepts a project without a visible coordinator (threads of another machine)', () => {
    const { projects } = groupByProject([thread('wherdr', '0018')])
    expect(projects[0]!.coordinator).toBeNull()
    expect(projects[0]!.panes).toHaveLength(1)
  })

  it('groups nothing without a project', () => {
    const list = [pane(), pane({ agent: 'codex' })]
    expect(groupByProject(list)).toEqual({ projects: [], others: list })
  })
})

describe('repository subgroups', () => {
  it('places the coordinator, each repository and the other spaces separately, sorted by urgency', () => {
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

  it('leaves spaces outside worktrees after the repositories', () => {
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

  it('ignores the technical value of a detached pane ("~!0003") and any non-conforming name', () => {
    expect(projectToken({ hp_group: '~!0003' })).toBeUndefined()
    expect(projectToken({ hp_project: '~!0006', hp_group: 'wherdr' })).toBe('wherdr')
    expect(projectToken({ hp_project: 'mon projet' })).toBeUndefined()
    // Closed thread left open: falls back on its name or worktree.
    expect(projectOf(pane({ project: '~!0003', name: 'hp-wherdr-t-0003-sujet' }))).toBe('wherdr')
    expect(projectOf(pane({ project: '~!0006', cwd: '/Users/a/.herdr/worktrees/herdr-web/hp-wherdr-t-0006-x' }))).toBe('wherdr')
    const { projects } = groupByProject([pane({ project: '~!0003', name: 'hp-wherdr-t-0003-sujet' })])
    expect(projects.map(p => p.name)).toEqual(['wherdr'])
  })
})
