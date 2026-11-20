// Named agents (Settings › Agents): a name for a command on some machines,
// usable wherever a workflow pref names an agent.
import { describe, expect, it } from 'vitest'
import { agentsMissing, namedAgentError, readNamedAgents, type NamedAgent } from '../shared/pm/namedAgents'
import { agentLine, reviewerPlan, taskAgents, workerPlan, type Task } from '../shared/pm/run'
import { checkPrefs, validateTemplate, type Template, type WorkflowError } from '../shared/pm/workflow'

const sub: NamedAgent = { name: 'omp-sub', program: 'omp', command: 'omp-sub --thinking medium', machines: ['laptop'] }
const template: Template = {
  id: 'vibe', prefs: { agent: 'omp-sub', model: 'sonnet', reviewModel: 'opus' },
  taskTypes: { simple: { steps: [{ id: 'work', holder: 'worker', ends: 'report' }, { id: 'review', holder: 'reviewer', ends: 'verdict', sendBack: 'work' }] } },
}
const task: Task = { id: 'WEB-1', project: 'WEB', title: 'T', description: 'D', type: 'simple', state: 'todo', createdAt: 0 }

describe('named agents', () => {
  it('starts the command and its options, then the program\'s usual arguments', () => {
    const plan = workerPlan(template, task, [sub])
    expect(plan).toEqual({ program: 'omp', agent: 'omp-sub', command: 'omp-sub --thinking medium', model: 'sonnet' })
    expect(agentLine(plan as { program: string, command: string }, 'sonnet', '/h/i.md', undefined, undefined, ['/h/ctx']))
      .toBe(`exec omp-sub '--thinking' 'medium' '--add-dir' '/h/ctx' '--model' 'sonnet' 'Read /h/i.md and follow it.'`)
    // The reviewer defaults to the worker's named agent, with its own model.
    expect(reviewerPlan(template, task, undefined, [sub])).toMatchObject({ agent: 'omp-sub', program: 'omp', model: 'opus' })
    expect(workerPlan(template, task, [])).toEqual({ reason: expect.stringContaining('cannot start "omp-sub"') })
  })

  it('checks prefs against the known names, and any well-formed name when they are not known', () => {
    const errs = (p: unknown, named?: NamedAgent[]) => { const e: WorkflowError[] = []; checkPrefs(p, 'prefs', e, named); return e.map(x => x.path) }
    expect(errs({ agent: 'omp-sub', reviewAgent: 'codex' }, [sub])).toEqual([])
    expect(errs({ agent: 'other', reviewFallbackAgent: 'omp-sub' }, [sub])).toEqual(['prefs.agent'])
    expect(errs({ agent: 'other' })).toEqual([])
    expect(errs({ agent: 'Not a name!' })).toEqual(['prefs.agent'])
    expect(validateTemplate(template, [sub])).toEqual([])
  })

  it('keeps only valid entries, and never a key in the command', () => {
    expect(readNamedAgents(JSON.stringify([sub, { ...sub }, { ...sub, name: 'claude' }, { ...sub, name: 'bad', command: 'x; rm' }]))).toEqual([sub])
    expect(namedAgentError({ ...sub, command: 'omp-sub --api-key=abc' })).toMatch(/No key/)
    expect(namedAgentError({ ...sub, command: 'API_KEY=abc omp' })).toMatch(/No key|executable/)
    expect(namedAgentError({ ...sub, command: 'omp-sub --api-key placeholder' })).toMatch(/No key/)
    expect(namedAgentError({ ...sub, command: 'omp-sub --token placeholder' })).toMatch(/No key/)
    expect(namedAgentError({ ...sub, command: 'omp-sub --profile "account two"' })).toMatch(/no quotes/)
    expect(namedAgentError({ ...sub, command: 'omp-sub --profile=two' })).toBeUndefined()
    expect(namedAgentError({ ...sub, machines: [] })).toMatch(/machine/)
  })

  it('a machine without the task\'s named agent takes nothing, and says which one', () => {
    const needed = taskAgents(template, task, [sub])
    expect(agentsMissing(needed, [sub], 'laptop')).toBeUndefined()
    expect(agentsMissing(needed, [sub], 'desktop')).toBe('no named agent omp-sub (Settings › Agents)')
    // Plain programs need nothing.
    expect(taskAgents({ ...template, prefs: { agent: 'claude', model: 'opus', reviewModel: 'sonnet' } }, task, [sub])).toEqual([])
  })
})
