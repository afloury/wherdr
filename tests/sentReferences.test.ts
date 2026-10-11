// A message that starts with a reference, matched against the conversation,
// Claude's queue and the agent's screen: the reference counts, not only the
// words under it.
import { describe, expect, it } from 'vitest'
import { decisionRef, messageRef, pointRef, refLine, sameSent } from '../shared/reference'
import { addAnswer } from '../app/utils/questionReply'
import { pendingQueue } from '../app/utils/pendingQueue'
import { queuedPhase } from '../shared/queuedPhase'
import { problemPrefix, questionPrefix } from '../shared/projectBoard'
import type { ClaudeScreen } from '../shared/types'

describe('messages still on their way', () => {
  const at = Date.parse('2026-01-01T11:38:00Z')
  const earlier = addAnswer('', decisionRef('1', 'Keep the cache?', '11:37'), 'Yes')!
  const queued = addAnswer('', decisionRef('2', 'Publish the release?', '11:38'), 'Yes')!
  const pending = (text: string, said: string) => pendingQueue({
    mine: [{ id: 'held', text, at, state: 'held' }],
    claude: [], screen: null,
    items: [{ role: 'user', text: said, ts: '2026-01-01T11:37:55Z' }],
  }).map(p => p.id)
  it('keeps a different decision pending when an earlier row has the same answer', () => {
    expect(pending(queued, earlier)).toEqual(['held'])
  })
  it('tells apart the same row of two tables by their codes', () => {
    const one = addAnswer('', decisionRef('1', 'Continue?', '11:37', false, 'k3f'), 'Yes')!
    const two = addAnswer('', decisionRef('1', 'Continue?', '11:37', false, 'k3f2'), 'Yes')!
    expect(pending(two, one)).toEqual(['held'])
  })
  it('still recognizes the message once it is in the conversation', () => {
    expect(pending(queued, queued.trim())).toEqual([])
    // Two answers under one reference are not each other.
    const ref = refLine(messageRef('Two options: A or B.', '11:37', 'k3f'))
    expect(pending(`${ref}\nA first detailed opinion`, `${ref}\nA second and different opinion`)).toEqual(['held'])
    // A reference sent alone, with nothing under it.
    expect(pending(ref, ref)).toEqual([])
    expect(pending(ref, refLine(messageRef('Two options: A or B.', '11:37', 'z9q')))).toEqual(['held'])
  })
  it('does not list twice a message Claude holds in its own queue', () => {
    const list = (mine: string, claude: string) => pendingQueue({
      mine: [{ id: 'held', text: mine, at }], claude: [{ text: claude, ts: '2026-01-01T11:38:01Z' }], screen: null, items: [],
    }).map(p => p.id)
    expect(list(queued, queued.trim())).toEqual(['held'])
    expect(list(queued, earlier.trim())).toHaveLength(2)
  })
  it('reads the phase of each on the agent screen', () => {
    const screen = { queued: [queued.trim()], sent: earlier.trim() } as unknown as ClaudeScreen
    expect(queuedPhase(earlier, screen)).toBe('sent')
    expect(queuedPhase(queued, screen)).toBe('queued')
    // The screen wraps and cuts long lines: a reference cut short is compared as it is.
    const long = `${refLine(pointRef('Shall I keep the current configuration until the migration finishes?', '11:37', 'k3f'))}\nYes`
    const cut = { queued: [], sent: '↳ Quote point 11:37 ~k3f : Shall I keep the current confi' } as unknown as ClaudeScreen
    expect(queuedPhase(long, cut)).toBe('sent')
  })
  it('compares the words under the same reference only', () => {
    const words = (a: string, b: string) => a === b
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
    expect(sameSent(norm(earlier), norm(queued), words)).toBe(false)
    expect(sameSent(norm(earlier), norm(earlier), words)).toBe(true)
    expect(sameSent('yes', 'yes', words)).toBe(true)
    expect(sameSent(norm(`${problemPrefix('Star', 'en')}It does not turn`), norm(`${questionPrefix('Star', 'en')}It does not turn`), words)).toBe(false)
  })
})
