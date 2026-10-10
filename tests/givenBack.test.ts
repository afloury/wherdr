// Messages the server gives back (held for an agent that will not come back):
// their text returns to the pane's message field, once, on one device.
import { describe, expect, it } from 'vitest'
import { createGivenBack } from '../app/utils/givenBack'
import type { DraftAtt } from '../app/composables/useDraft'
import type { ReplyTarget } from '../shared/replyQuote'
import type { Pane, QueuedMessage } from '../shared/types'

const LOG = Array.from({ length: 40 }, (_, i) => `==> Pouring pkg-${i}--1.0.arm64_sonoma.bottle.tar.gz`).join('\n')
const pane = (id: string, queued?: QueuedMessage[]) => ({ id, agent: null, ...(queued ? { queued } : {}) }) as Pane
const back = (id: string, text: string, more: Partial<QueuedMessage> = {}): QueuedMessage => ({ id, text, at: 1, state: 'failed', back: true, ...more })

function setup(refuse: string[] = []) {
  const drafts = new Map<string, { text: string, atts: DraftAtt[], reply: ReplyTarget | null }>()
  const draft = (id: string) => {
    if (!drafts.has(id)) drafts.set(id, { text: '', atts: [], reply: null })
    return drafts.get(id)!
  }
  const taken: string[] = []
  const done: [string, number][] = []
  const give = createGivenBack({
    take: async (paneId, q) => {
      await Promise.resolve()
      if (refuse.includes(q.id)) throw new Error('Message not found')
      taken.push(`${paneId} ${q.id}`)
      return q.text
    },
    draft,
    done: (paneId, n) => done.push([paneId, n]),
  })
  return { draft, taken, done, give }
}

describe('messages given back', () => {
  it('puts their text back into the pane’s field, after what is typed there, in order', async () => {
    const s = setup()
    s.draft('w1:p1').text = 'already typed'
    await s.give({ panes: [pane('w1:p1', [back('a', 'Held for the restart'), back('b', 'And this one')]), pane('w1:p2')] })
    expect(s.draft('w1:p1').text).toBe('already typed\nHeld for the restart\nAnd this one')
    expect(s.draft('w1:p2').text).toBe('')
    expect(s.taken).toEqual(['w1:p1 a', 'w1:p1 b'])
    expect(s.done).toEqual([['w1:p1', 2]])
  })

  it('leaves alone the messages that are still waiting or failed for another reason', async () => {
    const s = setup()
    await s.give({ panes: [pane('w1:p1', [{ id: 'a', text: 'held', state: 'held' }, { id: 'b', text: 'not sent', state: 'failed' }, { id: 'c', text: 'queued' }])] })
    expect(s.taken).toEqual([])
    expect(s.draft('w1:p1').text).toBe('')
    expect(s.done).toEqual([])
  })

  it('takes a record once, even when the next state still lists it', async () => {
    const s = setup()
    const state = { panes: [pane('w1:p1', [back('a', 'Held for the restart')])] }
    await Promise.all([s.give(state), s.give(state)])
    expect(s.taken).toEqual(['w1:p1 a'])
    expect(s.draft('w1:p1').text).toBe('Held for the restart')
  })

  it('writes nothing when another device took it, and tries again when the request failed', async () => {
    const s = setup(['a'])
    const state = { panes: [pane('w1:p1', [back('a', 'Held for the restart'), back('b', 'Mine')])] }
    await s.give(state)
    expect(s.draft('w1:p1').text).toBe('Mine')
    expect(s.done).toEqual([['w1:p1', 1]])
    // Still listed (a failed request): asked again, never doubled.
    await s.give({ panes: [pane('w1:p1', [back('a', 'Held for the restart')])] })
    expect(s.draft('w1:p1').text).toBe('Mine')
  })

  it('gives a pasted text back as a card, and keeps the reply being written', async () => {
    const s = setup()
    const reply = { time: '10:00', excerpt: 'The build passes.' }
    s.draft('w1:p1').reply = reply
    await s.give({ panes: [pane('w1:p1', [back('a', `fix this\n\n${LOG}`, { pasted: [LOG] })])] })
    expect(s.draft('w1:p1')).toEqual({ text: 'fix this', atts: [{ url: '', path: null, paste: LOG }], reply })
  })
})
