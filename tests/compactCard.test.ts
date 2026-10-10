import { describe, expect, it } from 'vitest'
import { compactMeta, compactOpen, readCompactList } from '../app/utils/compactCard'

describe('compact list setting', () => {
  it('is on for a device that never chose', () => {
    expect(readCompactList(null)).toBe(true)
  })
  it('keeps a saved choice, off included', () => {
    expect(readCompactList('1')).toBe(true)
    expect(readCompactList('0')).toBe(false)
  })
})

describe('compact list card', () => {
  it('shortens the coordinator role, keeps a thread number', () => {
    expect(compactMeta({ tag: 'coordinator', coordinator: true }).badge).toBe('coord')
    expect(compactMeta({ tag: 't-0007' }).badge).toBe('t-0007')
    expect(compactMeta({}).badge).toBeNull()
  })
  it('several tabs: dots per tab, no pane count', () => {
    expect(compactMeta({ tabs: 3, panes: 5 })).toMatchObject({ dots: true, panes: null })
  })
  it('one tab with several panes: pane count instead of dots', () => {
    expect(compactMeta({ tabs: 1, panes: 2 })).toMatchObject({ dots: false, panes: 2 })
  })
  it('single pane: neither', () => {
    expect(compactMeta({ tabs: 1, panes: 1 })).toMatchObject({ dots: false, panes: null })
    expect(compactMeta({})).toMatchObject({ dots: false, panes: null })
  })
})

describe('compact card of a waiting agent', () => {
  it('opens on a question, the requested action or one-tap answers', () => {
    expect(compactOpen({ status: 'blocked', preview: 'Do you want to proceed?' })).toBe(true)
    expect(compactOpen({ status: 'blocked', detail: { tool: 'bash' } })).toBe(true)
    expect(compactOpen({ status: 'blocked', choices: 2 })).toBe(true)
  })
  it('stays one line when the agent is not waiting, whatever its preview', () => {
    for (const status of ['working', 'done', 'idle', 'unknown', undefined, null])
      expect(compactOpen({ status, preview: 'Last answer', choices: 2 })).toBe(false)
  })
  it('stays one line when a waiting agent has nothing to show', () => {
    expect(compactOpen({ status: 'blocked' })).toBe(false)
    expect(compactOpen({ status: 'blocked', preview: '', detail: null, choices: 0 })).toBe(false)
  })
})
