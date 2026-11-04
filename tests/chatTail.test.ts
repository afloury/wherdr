import { describe, expect, it } from 'vitest'
import { reconcileTail } from '../app/utils/chatTail'
import type { ChatItem } from '../shared/types'

const item = (text: string, role: ChatItem['role'] = 'assistant'): ChatItem => ({ role, text, ts: '2026-01-01T00:00:00Z' })

describe('reconcileTail', () => {
  it('returns the current array itself when every item is equal', () => {
    const tail: ChatItem[] = [
      item('Add a resume step.', 'user'),
      { role: 'tool', name: 'Bash', text: 'npm test', ts: '2026-01-01T00:00:01Z' },
      item('Done, with **bold** text.'),
      { role: 'tool', name: 'Read', text: 'chatTail.ts', ts: '2026-01-01T00:00:03Z', omp: { title: 'Read', target: 'chatTail.ts', outLines: 66 }, job: { id: 'j1', tool: 'Read', out: 'ok' }, pasted: ['pasted text'], hashes: ['h1', 'h2'], images: 2, ref: 'l4', imageAt: 1, ms: 120 },
    ]
    // The same list as the server would send it back: fresh objects all along.
    expect(reconcileTail(tail, structuredClone(tail))).toBe(tail)
  })

  it('keeps the equal items\' objects and replaces only the changed one', () => {
    const tail: ChatItem[] = [
      item('Add a resume step.', 'user'),
      { role: 'tool', name: 'Bash', text: 'npm test', ts: '2026-01-01T00:00:01Z', omp: { title: 'Bash', target: 'npm test', out: 'ok' } },
      item('Done.'),
    ]
    const next = structuredClone(tail)
    next[1]!.omp!.out = 'ok\nwarnings: 2' // a nested field only
    const out = reconcileTail(tail, next)
    expect(out).not.toBe(tail)
    expect(out[0]).toBe(tail[0])
    expect(out[1]).toBe(next[1])
    expect(out[1]!.omp!.out).toBe('ok\nwarnings: 2')
    expect(out[2]).toBe(tail[2])
  })

  it('returns a new array on a length change, still keeping the equal items', () => {
    const tail = [item('Add a resume step.', 'user'), item('Done.')]
    const grown = [...structuredClone(tail), item('And a follow-up.')]
    const out = reconcileTail(tail, grown)
    expect(out).not.toBe(tail)
    expect(out).toHaveLength(3)
    expect(out[0]).toBe(tail[0])
    expect(out[1]).toBe(tail[1])
    expect(out[2]).toBe(grown[2])
    // Shorter too: the kept prefix keeps its objects.
    const shorter = [structuredClone(tail)[0]!]
    const back = reconcileTail(tail, shorter)
    expect(back).toHaveLength(1)
    expect(back[0]).toBe(tail[0])
  })

  it('compares position by position: a moved item is a different one', () => {
    const tail = [item('one', 'user'), item('two'), item('three')]
    const moved = [structuredClone(tail)[1]!, structuredClone(tail)[0]!, structuredClone(tail)[2]!]
    const out = reconcileTail(tail, moved)
    expect(out).not.toBe(tail)
    expect(out[0]).toBe(moved[0])
    expect(out[1]).toBe(moved[1])
    expect(out[2]).toBe(tail[2])
  })

  it('spots changes in every field, nested ones included', () => {
    const base = (patch: Partial<ChatItem>): ChatItem[] => [
      { role: 'tool', name: 'Read', text: 'a.ts', ts: '2026-01-01T00:00:00Z', pasted: ['p'], hashes: ['h'], job: { id: 'j', tool: 't', out: 'o' }, omp: { title: 'Read' }, error: false, ms: 1, ...patch },
    ]
    for (const patch of [
      { pasted: ['p', 'q'] },
      { hashes: ['h', 'h2'] },
      { job: { id: 'j', tool: 't', out: 'o2' } },
      { omp: { title: 'Read', outLines: 4 } },
      { error: true },
      { ms: 2 },
      { images: 1 },
      { ts: '2026-01-01T00:00:01Z' },
      { name: 'Write' },
    ] satisfies Partial<ChatItem>[]) {
      const a = base({})
      const b = base(patch)
      const out = reconcileTail(a, b)
      expect(out).not.toBe(a)
      expect(out).toHaveLength(1)
      expect(out[0]).toBe(b[0])
    }
  })
})
