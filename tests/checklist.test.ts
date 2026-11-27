import { describe, expect, it } from 'vitest'
import {
  applySent, applyToggle, changedItems, checklistBlock, checklistCounts, sanitizeChecklist, shouldPollChecklist,
  type ChecklistItem, type ChecklistState,
} from '../shared/checklist'

const time = (ms: number) => `t${ms}`

// The items as the page renders them (app/utils/checklistDom.ts): text and the agent's tick.
const items = (...list: [string, boolean?][]): ChecklistItem[] => list.map(([text, written], index) => ({ index, text, written: Boolean(written) }))
const msg = (at: number, ...list: [string, boolean?][]) => ({ at, items: items(...list) })

describe('toggle, changed items and block', () => {
  const m = msg(100, ['Header'], ['Footer', true], ['Alert card'], ['Alert card › one layout'])

  it('lists nothing when unchanged, and after ticking then unticking', () => {
    let s: ChecklistState = {}
    expect(changedItems(s)).toEqual([])
    expect(checklistBlock(s, time)).toBeNull()
    s = applyToggle(s, 'k', m, 0, true)
    s = applyToggle(s, 'k', m, 0, false)
    expect(changedItems(s)).toEqual([])
    expect(checklistBlock(s, time)).toBeNull()
    expect(checklistCounts(s)).toEqual({ ticked: 0, changed: 0 })
  })

  it('counts and sends only the user\'s own changes, never an item the agent ticked', () => {
    let s = applyToggle({}, 'k', m, 0, true)
    s = applyToggle(s, 'k', m, 3, true)
    const block = checklistBlock(s, time)!
    expect(block.text).toBe('Checklist from your t100 message:\n[x] Header\n[x] Alert card › one layout')
    expect(block.marks).toEqual([{ key: 'k', index: 0, value: true }, { key: 'k', index: 3, value: true }])
    expect(checklistCounts(s)).toEqual({ ticked: 2, changed: 2 })
  })

  it('sends an untick of the agent\'s own tick', () => {
    const s = applyToggle({}, 'k', m, 1, false)
    expect(checklistBlock(s, time)!.text).toBe('Checklist from your t100 message:\n[ ] Footer')
    expect(checklistCounts(s)).toEqual({ ticked: 0, changed: 1 })
  })

  it('shortens long text and names a message without a time without one', () => {
    const s = applyToggle({}, 'n', msg(0, ['x'.repeat(90)]), 0, true)
    expect(checklistBlock(s, time)!.text).toBe(`Checklist from your message:\n[x] ${'x'.repeat(59)}…`)
  })

  it('orders messages by time with a blank line between', () => {
    let s = applyToggle({}, 'late', msg(20, ['b']), 0, true)
    s = applyToggle(s, 'early', msg(10, ['a']), 0, true)
    expect(checklistBlock(s, time)!.text).toBe('Checklist from your t10 message:\n[x] a\n\nChecklist from your t20 message:\n[x] b')
  })

  it('takes the items a reply gained after a tick, keeping the ticks of those unchanged', () => {
    let s = applyToggle({}, 'k', msg(1, ['a']), 0, true)
    s = applyToggle(s, 'k', msg(1, ['a'], ['b']), 1, true)
    expect(checklistBlock(s, time)!.text).toBe('Checklist from your t1 message:\n[x] a\n[x] b')
  })

  it('does not mutate its input and ignores unknown indexes', () => {
    const s = applyToggle({}, 'k', m, 0, true)
    const frozen = JSON.stringify(s)
    applyToggle(s, 'k', m, 1, true)
    expect(JSON.stringify(s)).toBe(frozen)
    expect(applyToggle(s, 'k', m, 99, true)).toEqual(s)
  })
})

describe('applySent', () => {
  it('marks sent, and a later change is sent again', () => {
    const m = msg(1, ['a'], ['b'])
    let s = applyToggle({}, 'k', m, 0, true)
    s = applySent(s, checklistBlock(s, time)!.marks)
    expect(checklistBlock(s, time)).toBeNull()
    s = applyToggle(s, 'k', m, 1, true)
    expect(checklistBlock(s, time)!.text).toBe('Checklist from your t1 message:\n[x] b')
    s = applySent(s, [{ key: 'zz', index: 0, value: true }, { key: 'k', index: 9, value: true }])
    expect(changedItems(s)).toHaveLength(1)
  })
})

describe('shouldPollChecklist', () => {
  const on = { onScreen: true, visible: true, recent: true, unsent: false }
  it('polls the visible conversation on screen with a recent list or unsent ticks only', () => {
    expect(shouldPollChecklist(on)).toBe(true)
    expect(shouldPollChecklist({ ...on, recent: false, unsent: true })).toBe(true)
    expect(shouldPollChecklist({ ...on, recent: false })).toBe(false)
    expect(shouldPollChecklist({ ...on, visible: false })).toBe(false)
    expect(shouldPollChecklist({ ...on, onScreen: false, unsent: true })).toBe(false)
  })
})

describe('sanitizeChecklist', () => {
  const item = { text: 't', written: false, checked: true, sent: false }

  it('drops bad input', () => {
    expect(sanitizeChecklist(null)).toEqual({})
    expect(sanitizeChecklist([])).toEqual({})
    expect(sanitizeChecklist({
      a: { at: 'x', items: { 0: item } },
      b: { at: 1, items: { 0: { ...item, checked: 'yes' }, x: item } },
      c: { at: 1, items: { 0: item } },
    })).toEqual({ c: { at: 1, items: { 0: item } } })
  })

  it('caps messages, items and text', () => {
    const raw: Record<string, unknown> = {}
    for (let i = 0; i < 50; i++) raw[`m${i}`] = { at: i, items: { 0: item } }
    const out = sanitizeChecklist(raw)
    expect(Object.keys(out)).toHaveLength(40)
    expect(out.m49).toBeDefined()
    expect(out.m9).toBeUndefined()
    expect(out.m10).toBeDefined()

    const many: Record<string, unknown> = {}
    for (let i = 0; i < 250; i++) many[i] = { ...item, text: 'y'.repeat(300) }
    const big = sanitizeChecklist({ k: { at: 1, items: many } }).k!
    expect(Object.keys(big.items)).toHaveLength(200)
    expect(big.items['0']!.text).toHaveLength(200)
  })
})
