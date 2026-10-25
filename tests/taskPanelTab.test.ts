import { describe, expect, it } from 'vitest'
import { needsJumpTab, setTaskPanelChoice, taskPanelChoice, taskPanelTab, taskPanelTabs } from '../app/utils/taskPanelTab'

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
  it('offers the reviewer\'s pane while a review runs, before Task', () => {
    expect(taskPanelTabs({ chat: true, term: true, reviewer: true })).toEqual(['chat', 'term', 'reviewer', 'task'])
    expect(taskPanelTab({ chat: true, term: true, reviewer: true }, 'reviewer')).toBe('reviewer')
    // The review over: back to the default view.
    expect(taskPanelTab({ chat: true, term: true }, 'reviewer')).toBe('chat')
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

describe('Needs you banner jump', () => {
  it('never leads to the tab already shown', () => {
    const all = taskPanelTabs({ chat: true, term: true })
    expect(needsJumpTab(all, 'chat')).toBe('term')
    expect(needsJumpTab(all, 'task')).toBe('term')
    expect(needsJumpTab(all, 'term')).toBe('chat')
    for (const tab of all) expect(needsJumpTab(all, tab)).not.toBe(tab)
  })
  it('offers nothing when the other tab is not there', () => {
    expect(needsJumpTab(taskPanelTabs({ chat: true, term: false }), 'chat')).toBeNull()
    expect(needsJumpTab(taskPanelTabs({ chat: false, term: false }), 'task')).toBeNull()
    expect(needsJumpTab(['term', 'task'], 'term')).toBeNull()
  })
})

it('offers settings for tasks and retains the selected settings view', () => {
  const views = { chat: true, term: true, settings: true }
  expect(taskPanelTabs(views)).toEqual(['chat', 'term', 'task', 'settings'])
  expect(taskPanelTab(views, 'settings')).toBe('settings')
})
