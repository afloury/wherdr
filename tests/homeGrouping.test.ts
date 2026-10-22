import { describe, expect, it } from 'vitest'
import { readHomeGrouping, stateEntries } from '../app/utils/homeGrouping'
import type { BoardSections, Member } from '../shared/boardLinks'
import type { Pane } from '../shared/types'
import type { Row } from '../shared/spaces'

const row = (id: string, agent: string | null = 'codex'): Row => {
  const pane = { id, agent } as Pane
  return { kind: 'pane', key: id, pane, lead: pane }
}
const coordinator = row('coordinator')
const task = { row: row('task'), task: { id: 'demo/1' }, role: 'worker' } as Member
const shell = row('shell', null)
const sections: BoardSections = {
  coordinators: [{ row: row('machine-coordinator'), level: 'machine' }],
  projects: [{ id: 'demo', repo: 'demo', key: 'DEMO', info: null, coordinator, space: shell, remote: null,
    members: [task, { row: row('unlinked'), task: null, role: 'worker' }],
    sum: { blocked: 0, working: 0, ready: 3, total: 3 }, state: 'ready' }],
  others: [row('agent'), row('terminal', null)],
}

describe('home grouping', () => {
  it('preserves Machine as the default for missing and invalid stored values', () => {
    for (const v of [null, undefined, '', 'unknown', 'machine', 1]) expect(readHomeGrouping(v)).toBe('machine')
    expect(readHomeGrouping('state')).toBe('state')
  })
  it('flattens all coordinator levels, tasks and ordinary agents without losing task metadata', () => {
    const entries = stateEntries(sections, false)
    expect(entries.map(e => e.row.key)).toEqual(['machine-coordinator', 'coordinator', 'task', 'unlinked', 'agent'])
    expect(entries[0]?.level).toBe('machine')
    expect(entries[1]).toMatchObject({ repo: 'demo', level: 'project' })
    expect(entries[2]?.member).toBe(task)
    expect(entries[3]?.repo).toBe('demo')
  })
  it('includes repository shells and ordinary terminals only when enabled', () => {
    expect(stateEntries(sections, true).map(e => e.row.key)).toEqual(['machine-coordinator', 'coordinator', 'shell', 'task', 'unlinked', 'agent', 'terminal'])
  })
  it('does not invent a row when the project coordinator and checkout are elsewhere', () => {
    const project = { ...sections.projects[0]!, coordinator: null, space: null }
    expect(stateEntries({ coordinators: [], projects: [project], others: [] }, false).map(e => e.row.key)).toEqual(['task', 'unlinked'])
  })
})
