// Waiting messages show in sending order, whatever their source (WHR-545).
import { describe, expect, it } from 'vitest'
import { pendingQueue } from '../app/utils/pendingQueue'

describe('waiting messages: sending order', () => {
  it('a choice reply only in Claude\'s queue, then a typed message still in wherdr\'s records: the reply on top', () => {
    const reply = '↳ 00:50 Which one do I start?\nThe 7 major bugs'
    const typed = 'and then the minor ones'
    // The reply's wherdr record was pruned once Claude got it: only Claude's queue lists it.
    const mine = [{ id: 'w-2', text: typed, at: Date.parse('2026-01-01T00:01:00Z'), settledAt: Date.parse('2026-01-01T00:01:01Z') }]
    const claude = [{ text: reply, ts: '2026-01-01T00:00:30Z' }, { text: typed, ts: '2026-01-01T00:01:01Z' }]
    const list = pendingQueue({ mine, claude, items: [], screen: null })
    expect(list.map(q => q.raw)).toEqual([reply, typed])
    expect(list.map(q => q.mine)).toEqual([false, true])
  })
})
