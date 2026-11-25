import { describe, expect, it } from 'vitest'
import {
  applySent, applyToggle, changedItems, checklistBlock, checklistCounts, parseChecklist, sanitizeChecklist,
  type ChecklistState,
} from '../shared/checklist'

const time = (ms: number) => `t${ms}`

const MD = [
  'Plan:',
  '- [ ] Header',
  '- [x] Footer',
  '',
  'More:',
  '1. [ ] Alert card',
  '   - [ ] one layout',
  '   - [X] two layouts',
  '- plain parent',
  '  * [ ] child',
].join('\n')

describe('parseChecklist', () => {
  it('lists task items in order with groups, labels and written state', () => {
    expect(parseChecklist(MD)).toEqual([
      { index: 0, group: 1, text: 'Header', written: false },
      { index: 1, group: 1, text: 'Footer', written: true },
      { index: 2, group: 2, text: 'Alert card', written: false },
      { index: 3, group: 2, text: 'Alert card › one layout', written: false },
      { index: 4, group: 2, text: 'Alert card › two layouts', written: true },
      { index: 5, group: 2, text: 'plain parent › child', written: false },
    ])
  })

  it('skips fenced code and finds items inside details', () => {
    const md = ['<details>', '<summary>More</summary>', '', '```md', '- [ ] fake', '```', '', '- [ ] real', '', '</details>'].join('\n')
    expect(parseChecklist(md)).toEqual([{ index: 0, group: 1, text: 'real', written: false }])
  })

  it('starts a new group after a gap and strips inline markup', () => {
    const items = parseChecklist('- [ ] **a**\n\n- [ ] `b`\ntext\n+ [ ] [c](http://x)')
    expect(items.map(i => [i.group, i.text])).toEqual([[1, 'a'], [2, 'b'], [3, 'c']])
  })

  it('ignores plain bullets', () => {
    expect(parseChecklist('- one\n- two')).toEqual([])
  })
})

const msg = (md: string, at = 1) => ({ at, items: parseChecklist(md) })

describe('toggle, changed items and block', () => {
  const m = msg(MD, 100)

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

  it('lists every item of the changed group only, ticked and unticked', () => {
    const s = applyToggle({}, 'k', m, 0, true)
    const block = checklistBlock(s, time)!
    expect(block.text).toBe('Checklist from your t100 message:\n[x] Header\n[x] Footer')
    expect(block.marks).toEqual([{ key: 'k', index: 0, value: true }, { key: 'k', index: 1, value: true }])
    expect(checklistCounts(s)).toEqual({ ticked: 2, changed: 1 })
  })

  it('uses the nested label path and shortens long text', () => {
    const long = 'x'.repeat(90)
    const n = msg(`- [ ] A\n  - [ ] b\n\n- [ ] ${long}`, 5)
    let s = applyToggle({}, 'n', n, 1, true)
    expect(checklistBlock(s, time)!.text).toBe('Checklist from your t5 message:\n[ ] A\n[x] A › b')
    s = applyToggle(s, 'n', n, 2, true)
    const lines = checklistBlock(s, time)!.text.split('\n')
    expect(lines.at(-1)).toBe(`[x] ${'x'.repeat(59)}…`)
  })

  it('orders messages by time with a blank line between', () => {
    let s = applyToggle({}, 'late', msg('- [ ] b', 20), 0, true)
    s = applyToggle(s, 'early', msg('- [ ] a', 10), 0, true)
    expect(checklistBlock(s, time)!.text).toBe('Checklist from your t10 message:\n[x] a\n\nChecklist from your t20 message:\n[x] b')
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
    const m = msg('- [ ] a\n- [ ] b', 1)
    let s = applyToggle({}, 'k', m, 0, true)
    const block = checklistBlock(s, time)!
    s = applySent(s, block.marks)
    expect(checklistBlock(s, time)).toBeNull()
    s = applyToggle(s, 'k', m, 1, true)
    expect(checklistBlock(s, time)!.text).toBe('Checklist from your t1 message:\n[x] a\n[x] b')
    s = applySent(s, [{ key: 'zz', index: 0, value: true }, { key: 'k', index: 9, value: true }])
    expect(changedItems(s)).toHaveLength(1)
  })
})

describe('sanitizeChecklist', () => {
  const item = { group: 1, text: 't', written: false, checked: true, sent: false }

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

    const items: Record<string, unknown> = {}
    for (let i = 0; i < 250; i++) items[i] = { ...item, text: 'y'.repeat(300) }
    const big = sanitizeChecklist({ k: { at: 1, items } }).k
    expect(Object.keys(big.items)).toHaveLength(200)
    expect(big.items['0'].text).toHaveLength(200)
  })
})
