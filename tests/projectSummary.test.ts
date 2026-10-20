import { describe, expect, it } from 'vitest'
import type { Pane } from '../shared/types'
import type { Member } from '../shared/boardLinks'
import { summaryParts, taskSummary } from '../app/utils/projectSummary'

const pane = (id: string, p: Partial<Pane> = {}): Pane => ({ id, workspace: id.split(':')[0]!, tab: `${id}:t`, tabLabel: null, agent: 'claude', name: null, label: null, status: 'idle', title: null, cwd: '/tmp/demo', agentSession: null, ...p })
const member = (p: Pane): Member => ({ row: { kind: 'pane', key: p.id, pane: p, lead: p }, task: null, role: 'worker' })
const en = (e: string) => e
const fr = (_: string, f: string) => f

describe('the summary of a repo group', () => {
  it('counts the tasks, those waiting for you, working and at their limit', () => {
    const s = taskSummary([
      member(pane('a:1', { status: 'blocked' })),
      member(pane('b:1', { status: 'working' })),
      member(pane('c:1', { status: 'idle', usageLimit: {} as Pane['usageLimit'] })),
      member(pane('d:1', { status: 'done' })),
    ])
    expect(s).toEqual({ tasks: 4, blocked: 1, working: 1, limit: 1 })
    expect(summaryParts(s, en).map(p => p.text)).toEqual(['4 tasks', '1 your turn', '1 working', '1 limit'])
    expect(summaryParts(s, fr).map(p => p.text)).toEqual(['4 tâches', '1 à toi', '1 en cours', '1 limite'])
  })

  it('leaves out the counts at zero, says when there is no task, and the singular', () => {
    expect(summaryParts(taskSummary([]), en).map(p => p.text)).toEqual(['No tasks'])
    expect(summaryParts(taskSummary([]), fr).map(p => p.text)).toEqual(['Aucune tâche'])
    expect(summaryParts(taskSummary([member(pane('a:1'))]), fr).map(p => p.text)).toEqual(['1 tâche'])
    expect(summaryParts({ tasks: 3, blocked: 0, working: 0, limit: 2 }, en).map(p => p.key)).toEqual(['tasks', 'limit'])
    expect(summaryParts({ tasks: 3, blocked: 0, working: 0, limit: 2 }, fr)[1]!.text).toBe('2 limites')
  })
})
