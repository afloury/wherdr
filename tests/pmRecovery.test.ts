import { describe, expect, it } from 'vitest'
import { causeGone, interrupted, resumeOrder } from '../shared/pm/recovery'
import { recovering, type Incident } from '../shared/pm/incident'
import { chainState } from '../shared/pm/advance'
import { coordinatorStartRefusal } from '../shared/pm/autopilot'
import { cardOf } from '../shared/pm/board'
import { initialState } from '../shared/pm/steps'
import { agentLine, type Task } from '../shared/pm/run'

const NOW = Date.parse('2026-01-10T12:00:00Z')
const task = (id: string, more: Partial<Task> = {}): Task => ({ id, project: 'CO', title: id, description: '', type: 'simple', state: 'working', run: `r-${id}`, step: { ...initialState(), started: true, since: 1 }, createdAt: Number(id.split('-')[1]), ...more })
const incident = (cause: Incident['cause'], machine = 'b'): Incident => ({ id: 'i1', at: NOW, machine, label: 'host-b', cause, evidence: [], tasks: [], runs: [] })
// The engine's resume: a new run, working again.
const resumed = (t: Task, at = NOW): Task => ({ ...t, state: 'working', waiting: undefined, run: `${t.run}+`, recovery: { ...t.recovery!, waits: undefined, resumedAt: at } })

describe('crash recovery: the engine resumes the work by itself', () => {
  it('a restart of a machine resumes its tasks, the ones before first', () => {
    const a = interrupted(task('CO-1'), incident('restart'), NOW).task
    const b = interrupted(task('CO-2', { after: 'CO-1' }), incident('restart'), NOW).task
    expect(a).toMatchObject({ state: 'waiting', waiting: expect.stringMatching(/restarted.*wherdr resumes it now$/) })
    expect(recovering(a)).toBe(true)
    // Waiting for the engine, not the user: no Your turn.
    expect(cardOf(a, [], []).yourTurn).toBeUndefined()
    expect(resumeOrder([b, a]).map(t => t.id)).toEqual(['CO-1'])
    expect(resumeOrder([b, resumed(a)]).map(t => t.id)).toEqual(['CO-2'])
    expect(causeGone(a.recovery!, { online: true, limited: false })).toBe(true)
  })

  it('a follower of a task being resumed waits quietly, then starts once it is done', () => {
    const a = interrupted(task('CO-1'), incident('killed'), NOW).task
    const next = task('CO-3', { state: 'todo', after: 'CO-1', run: undefined, step: undefined })
    expect(chainState(next, [a, next])).toEqual({ resumes: 'CO-1' })
    expect(coordinatorStartRefusal(undefined, next, [a, next], [], NOW, false, { engine: true })).toBe('Waits for CO-1 to resume')
    expect(chainState(next, [resumed(a), next])).toBeUndefined()
    expect(chainState(next, [{ ...resumed(a), step: { ...a.step!, done: true } }, next])).toBe('go')
  })

  it('a machine still offline keeps its tasks waiting; an account limit until it resets', () => {
    const off = interrupted(task('CO-1'), incident('offline'), NOW).task
    expect(off.waiting).toMatch(/once host-b is back$/)
    expect(causeGone(off.recovery!, { online: false, limited: false })).toBe(false)
    expect(causeGone({ cause: 'restart' }, { online: false, limited: false })).toBe(false)
    expect(causeGone({ cause: 'limit' }, { online: true, limited: true })).toBe(false)
    expect(causeGone({ cause: 'limit' }, { online: true, limited: false })).toBe(true)
  })

  it('the same cause right after a resume goes to the coordinator, once', () => {
    const first = interrupted(task('CO-1'), incident('killed'), NOW)
    expect(first.escalate).toBeUndefined()
    const again = interrupted(resumed(first.task), incident('killed'), NOW + 60_000)
    expect(again.escalate).toMatch(/CO-1 stopped again right after the engine resumed it/)
    expect(again.task.waiting).toMatch(/the coordinator was told/)
    expect(recovering(again.task)).toBe(false)
    expect(resumeOrder([again.task])).toEqual([])
    // Another cause, or hours later: resumed again.
    expect(interrupted(resumed(first.task), incident('restart'), NOW + 60_000).escalate).toBeUndefined()
    expect(interrupted(resumed(first.task), incident('killed'), NOW + 2 * 3_600_000).escalate).toBeUndefined()
  })

  it('a Claude worker keeps its conversation id, and takes it up again', () => {
    expect(agentLine('claude', 'opus', '/h/i.md', { id: 's1' })).toBe(`exec claude '--model' 'opus' '--session-id' 's1' 'Read /h/i.md and follow it.'`)
    expect(agentLine('claude', 'opus', '/h/i.md', { id: 's1', resume: 'Go on.' })).toBe(`exec claude '--model' 'opus' '--resume' 's1' 'Go on.'`)
    expect(agentLine('codex', 'gpt-5', '/h/i.md', { id: 's1' })).toBe(`exec codex '--model' 'gpt-5' 'Read /h/i.md and follow it.'`)
  })
})
