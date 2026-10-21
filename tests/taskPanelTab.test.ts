import { describe, expect, it } from 'vitest'
import { setTaskPanelChoice, taskPanelChoice, taskPanelTab, taskPanelTabs } from '../app/utils/taskPanelTab'

describe('task panel tab', () => {
  it('opens on Task with the other tabs hidden when there is nothing to talk to', () => {
    expect(taskPanelTabs({ chat: false, term: false })).toEqual(['task'])
    expect(taskPanelTab({ chat: false, term: false }, null)).toBe('task')
    expect(taskPanelTab({ chat: false, term: false }, 'chat')).toBe('task')
  })
  it('opens on Conversation once there is an agent', () => {
    expect(taskPanelTabs({ chat: true, term: true })).toEqual(['chat', 'term', 'task'])
    expect(taskPanelTab({ chat: true, term: true }, null)).toBe('chat')
    expect(taskPanelTabs({ chat: true, term: false })).toEqual(['chat', 'task'])
  })
  it('keeps a choice while it is offered', () => {
    expect(taskPanelTab({ chat: true, term: true }, 'task')).toBe('task')
    expect(taskPanelTab({ chat: true, term: true }, 'term')).toBe('term')
    expect(taskPanelTab({ chat: true, term: false }, 'term')).toBe('chat')
  })
  it('remembers a choice per task', () => {
    setTaskPanelChoice('m|demo/1', 'task')
    expect(taskPanelChoice('m|demo/1')).toBe('task')
    expect(taskPanelChoice('m|demo/2')).toBeNull()
    setTaskPanelChoice('m|demo/1', null)
    expect(taskPanelChoice('m|demo/1')).toBeNull()
  })
})
