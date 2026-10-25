import { describe, expect, it } from 'vitest'
import { autopilotId, autopilotOnArgs, coordinatorShowArgs, parseAutopilotList, parseCoordinatorSettings } from '../shared/autopilot'

describe('Autopilot protocol', () => {
  it('requires a goal and sends its text as one argument', () => {
    expect(() => autopilotOnArgs({ kind: 'main' }, {})).toThrow('goal is required')
    expect(() => autopilotOnArgs({ kind: 'main' }, { goal: '  ' })).toThrow('goal is required')
    expect(autopilotOnArgs({ kind: 'project', repo: 'demo' }, { goal: ' Keep "the garden" healthy ', every: '2h', tasksPerDay: '3', tasksAtOnce: ' 1 ' })).toEqual([
      'autopilot', 'on', '--project', 'demo', '--goal', 'Keep "the garden" healthy', '--autopilot.every', '2h', '--autopilot.tasksPerDay', '3', '--autopilot.tasksAtOnce', '1',
    ])
    expect(autopilotOnArgs({ kind: 'machine' }, { goal: 'Grow', every: '', tasksPerDay: '  ' })).toEqual(['autopilot', 'on', '--machine', '--goal', 'Grow'])
  })
  it('refuses settings that are not plain values', () => {
    expect(() => autopilotOnArgs({ kind: 'main' }, { goal: 'Grow', every: '--all' })).toThrow('Invalid Autopilot setting')
    expect(() => autopilotOnArgs({ kind: 'main' }, { goal: 'Grow', tasksPerDay: 3 })).toThrow('Invalid Autopilot setting')
  })
  it('names each coordinator as autopilot --json does', () => {
    expect(autopilotId({ kind: 'main' })).toBe('main')
    expect(autopilotId({ kind: 'machine' })).toBe('machine')
    expect(autopilotId({ kind: 'project', repo: 'demo' })).toBe('project:demo')
    expect(coordinatorShowArgs({ kind: 'project', repo: 'demo' })).toEqual(['--project-coordinator', 'demo'])
    expect(coordinatorShowArgs({ kind: 'machine' })).toEqual(['--machine-coordinator'])
  })
  it('reads every coordinator of the machine', () => {
    const list = parseAutopilotList(JSON.stringify([
      { on: false, coordinator: 'main', name: 'Coordinator' },
      { on: true, state: 'on', coordinator: 'project:demo', goal: 'Grow', next: 'next in 59m', couldNot: '', settings: [] },
      { coordinator: 'broken' },
    ]))
    expect(list).toEqual({
      'main': { on: false, goal: '', next: '', state: '', couldNot: '' },
      'project:demo': { on: true, goal: 'Grow', next: 'next in 59m', state: 'on', couldNot: '' },
    })
    expect(() => parseAutopilotList('{}')).toThrow('Invalid Autopilot status')
  })
  it('reads the saved goal and defaults; an unset goal is "none"', () => {
    const settings = (goal: string) => JSON.stringify({ settings: [
      { name: 'autopilot.goal', value: goal }, { name: 'autopilot.every', value: '6h' },
      { name: 'autopilot.tasksPerDay', value: 5 }, { name: 'autopilot.tasksAtOnce', value: 2 }, { name: 'worker.agent', value: 'claude' },
    ] })
    expect(parseCoordinatorSettings(settings('Grow'))).toEqual({ goal: 'Grow', defaults: { every: '6h', tasksPerDay: '5', tasksAtOnce: '2' } })
    expect(parseCoordinatorSettings(settings('none')).goal).toBe('')
    expect(parseCoordinatorSettings('{}')).toEqual({ goal: '', defaults: { every: '', tasksPerDay: '', tasksAtOnce: '' } })
  })
})
