// Pasted texts sent from wherdr's field, kept by the server for every device:
// what a request may add, the bounds of the list, and the conversation and
// queued records served with their pasted texts listed.
import { describe, expect, it } from 'vitest'
import { PASTES_MAX, PASTES_MAX_CHARS, addPastes, loadPastes, pastedIn, pastesAt, withPasted, withQueuedPasted } from '../server/utils/pastes'
import { messageBody, pasteRanges, splitPasted } from '../shared/pastedText'
import type { ChatItem } from '../shared/types'

const log = (name: string, n = 40) => Array.from({ length: n }, (_, i) => `==> Pouring ${name}-${i}--1.0.arm64_sonoma.bottle.tar.gz`).join('\n')
const LOG = log('pkg')
const OTHER = log('lib')
const TYPED = Array.from({ length: 20 }, (_, i) => `Step ${i + 1}: check the service and write down what you see.`).join('\n')
const user = (text: string, pasted?: string[]): ChatItem => ({ role: 'user', text, ts: null, ...(pasted ? { pasted } : {}) })

describe('pasted texts of a request', () => {
  it('reads the blocks at the ranges the app gives', () => {
    const body = messageBody('fix this', [LOG, OTHER], ['@/tmp/a.txt'])
    const ranges = pasteRanges(body, [LOG, OTHER])
    expect(ranges).toEqual([[10, LOG.length], [12 + LOG.length, OTHER.length]])
    expect(pastesAt(body, ranges)).toEqual([LOG, OTHER])
    // After the JSON round trip of the request.
    expect(pastesAt(body, JSON.parse(JSON.stringify(ranges)))).toEqual([LOG, OTHER])
  })

  it('ignores a block the message does not hold, and anything malformed', () => {
    expect(pasteRanges('fix this', [LOG])).toEqual([])
    const body = `fix this\n\n${LOG}`
    for (const bad of [undefined, null, 'x', {}, [[0]], [['0', 5]], [[-1, 20]], [[0, 0]], [[1.5, 20]], [[10, LOG.length + 1]], [null], [[0, 8]]]) {
      expect(pastesAt(body, bad)).toEqual([])
    }
    // The same block twice: once.
    expect(pastesAt(body, [[10, LOG.length], [10, LOG.length]])).toEqual([LOG])
  })
})

describe('kept pasted texts', () => {
  it('keeps the most recent first, each block once', () => {
    let list = addPastes([], [LOG])
    list = addPastes(list, [OTHER])
    expect(list).toEqual([OTHER, LOG])
    expect(addPastes(list, [LOG])).toEqual([LOG, OTHER])
  })

  it('is the same list when nothing changes: nothing to write', () => {
    const list = addPastes([], [LOG, OTHER])
    // A message without a paste, and the paste just sent, sent again.
    expect(addPastes(list, [])).toBe(list)
    expect(addPastes(list, [LOG])).toBe(list)
    expect(addPastes(list, pastesAt('a short message', undefined))).toBe(list)
  })

  it('is bounded in number and in size: the oldest go', () => {
    let list: string[] = []
    for (let i = 0; i < PASTES_MAX + 5; i++) list = addPastes(list, [log(`n${i}`)])
    expect(list).toHaveLength(PASTES_MAX)
    expect(list[0]).toBe(log(`n${PASTES_MAX + 4}`))
    expect(list).not.toContain(log('n0'))
    const big = (c: string) => c.repeat(PASTES_MAX_CHARS / 2 - 10)
    list = addPastes(addPastes(addPastes([], [big('a')]), [big('b')]), [big('c')])
    expect(list).toEqual([big('c'), big('b')])
  })

  it('reads back well-formed blocks only', () => {
    expect(loadPastes([LOG, 3, null, 'short', OTHER])).toEqual([LOG, OTHER])
    expect(loadPastes({ a: LOG })).toEqual([])
    expect(loadPastes(null)).toEqual([])
  })
})

describe('conversation served to every device', () => {
  it('lists the pasted text of a message sent from another device', () => {
    const items = [user('hello'), { role: 'assistant', text: LOG, ts: null } as ChatItem, user(`fix this\n\n${LOG}`), user(TYPED)]
    const out = withPasted(items, [OTHER, LOG])
    expect(out.map(i => i.pasted)).toEqual([undefined, undefined, [LOG], undefined])
    // Untouched items are the same objects.
    expect(out[0]).toBe(items[0])
    expect(out[3]).toBe(items[3])
    // A device that never sent it shows the words and the card.
    expect(splitPasted(out[2]!.text, out[2]!.pasted, [])).toEqual({ text: 'fix this', pastes: [LOG] })
    // And so does the one that sent it.
    expect(splitPasted(out[2]!.text, out[2]!.pasted, [LOG])).toEqual({ text: 'fix this', pastes: [LOG] })
  })

  it('changes nothing without kept pasted texts', () => {
    const items = [user(`fix this\n\n${LOG}`)]
    expect(withPasted(items, [])).toBe(items)
  })

  it('keeps long typed words a message, next to the paste', () => {
    const [item] = withPasted([user(messageBody(TYPED, [LOG], []))], [LOG])
    expect(splitPasted(item!.text, item!.pasted, [])).toEqual({ text: TYPED, pastes: [LOG] })
  })

  it('lists several pasted texts in the order of the message', () => {
    expect(pastedIn([LOG, OTHER], `see\n\n${OTHER}\n\n${LOG}`)).toEqual([OTHER, LOG])
  })

  it('takes the whole block when a kept one sits inside another', () => {
    const inner = LOG.split('\n').slice(5, 25).join('\n')
    // The inner block was sent last: still the whole paste as one card.
    expect(pastedIn([inner, LOG], `fix this\n\n${LOG}`)).toEqual([LOG])
  })

  it('keeps the blocks Claude lists (a paste into its terminal)', () => {
    const text = `Why?\n\n${OTHER}`
    const [same] = withPasted([user(text, [OTHER])], [LOG])
    expect(same!.pasted).toEqual([OTHER])
    // Claude lists the whole wherdr send when words were typed in its terminal
    // too: the kept paste inside it wins, the words stay.
    const whole = `fix this\n\n${LOG}`
    const [cut] = withPasted([user(`also\n${whole}`, [whole])], [LOG])
    expect(cut!.pasted).toEqual([LOG])
  })

  it('finds a paste the server clipped by its start', () => {
    const long = log('big', 600)
    const text = `fix this\n\n${long}`.slice(0, 20000) + '…'
    const [item] = withPasted([user(text)], [long])
    expect(item!.pasted).toEqual([long])
    expect(splitPasted(item!.text, item!.pasted, [])).toEqual({ text: 'fix this', pastes: [long] })
  })
})

describe('queued record', () => {
  it('lists its pasted texts, cut like its text', () => {
    const long = log('big', 600)
    const q = { id: 'w-1', text: `fix this\n\n${long}`.slice(0, 4000), at: 1 }
    const out = withQueuedPasted(q, [long])
    expect(out.pasted).toEqual([long.slice(0, 4000)])
    // Another device: the words and a card of what the record holds.
    expect(splitPasted(out.text, out.pasted, []).text).toBe('fix this')
    // The device that sent it shows the whole paste.
    expect(splitPasted(out.text, out.pasted, [long])).toEqual({ text: 'fix this', pastes: [long] })
  })

  it('is unchanged without a paste', () => {
    const q = { id: 'w-1', text: TYPED, at: 1 }
    expect(withQueuedPasted(q, [LOG])).toBe(q)
  })
})
