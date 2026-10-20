// A message sent while the agent is in the middle of a turn. Checked on
// Claude Code 2.1.304 and Codex 0.163 (Herdr 0.9.5):
// - Claude Code takes text + Enter during a turn into its own queue: the field
//   empties, the message shows above the spinner, "Press up to edit queued
//   messages" fills the field, and the transcript gets an `enqueue`, then the
//   message as a `queued_command` attachment (timestamped when it was queued)
//   when Claude absorbs it at its next step, or as a plain message at the end
//   of the turn (`dequeue`);
// - Codex takes Enter during a turn at once: the message joins the running
//   turn and is written to its transcript right away.
// What went wrong was wherdr's side: a screen that lags (a long session, a
// loaded machine) made the send give up before or after Enter, leaving the
// text in the agent's field and the bubble on "Not sent", even when the agent
// took it late. These tests play that lag against fake fields.
import { describe, expect, it } from 'vitest'
import { type GuardDeps, confirmSubmitted, guardedSend } from '../server/utils/guardedSend'
import { HOLD_TTL_MS, type QueueEntry, checkQueue, landed, loadQueued, publicEntry } from '../server/utils/queued'
import { addSending, failLocal, prune, withOutbox } from '../app/utils/outbox'
import type { ChatItem } from '../shared/types'

const OURS = 'and while you are at it, check the changelog too'
const opts = { freeWaitMs: 500, quietMs: 0, showWaitMs: 500, submitWaitMs: 600, lateMs: 1000, pollMs: 100 }

// A field whose screen shows what was typed or done `lag` ms later (the TUI
// draws late), and that may drop Enters.
function laggy(o: { lag?: number, loseEnters?: number, box?: string, staleAfterEnter?: boolean } = {}) {
  const f = {
    box: o.box ?? '',
    shown: [] as { at: number, box: string }[],
    clock: 0,
    submitted: [] as string[],
    keys: [] as string[],
    typed: [] as string[],
    loseEnters: o.loseEnters ?? 0,
    set(box: string) { f.box = box; f.shown.push({ at: f.clock + (o.lag ?? 0), box }) },
  }
  const view = () => {
    let v = o.box ?? ''
    for (const s of f.shown) if (s.at <= f.clock) v = s.box
    return v
  }
  const deps: GuardDeps = {
    box: async () => { f.clock += 20; return view() },
    type: async (t) => { f.typed.push(t); f.set(f.box + t) },
    keys: async (keys) => {
      for (const k of keys) {
        f.keys.push(k)
        if (k === 'ctrl+u' || k === 'backspace') f.set('')
        if (k === 'enter') {
          if (f.loseEnters > 0) { f.loseEnters--; continue }
          if (f.box) f.submitted.push(f.box)
          // A screen that does not redraw after Enter (stale): the field still
          // shows the text the agent already took.
          if (o.staleAfterEnter) f.box = ''
          else f.set('')
        }
      }
    },
    sleep: async (ms) => { f.clock += ms },
    now: () => f.clock,
    sentSince: async () => [...f.submitted],
  }
  return { f, deps, view }
}

describe('Claude Code: send during a turn on a screen that lags', () => {
  it('text drawn late: still waited for, then submitted once', async () => {
    const { f, deps } = laggy({ lag: 900 })
    await guardedSend(deps, OURS, opts)
    expect(f.submitted).toEqual([OURS])
    expect(f.typed).toEqual([OURS])
  })

  it('text never fully drawn: given up, our part taken out of the field, error marked as typed', async () => {
    const { f, deps, view } = laggy()
    // The field shows the start of our text only, and stays so.
    deps.type = async (t) => { f.typed.push(t); f.set(t.slice(0, 10)) }
    await expect(guardedSend(deps, OURS, opts)).rejects.toMatchObject({ code: 'not_shown', typed: true })
    expect(view()).toBe('')
    expect(f.submitted).toEqual([])
  })

  it('Enter never taken: pressed twice at most, then our text taken out of the field (never left half-sent)', async () => {
    const { f, deps, view } = laggy({ loseEnters: 9 })
    await expect(guardedSend(deps, OURS, opts)).rejects.toMatchObject({ code: 'not_submitted', typed: true })
    expect(f.keys.filter(k => k === 'enter')).toHaveLength(2)
    expect(view()).toBe('')
  })

  it('screen still showing the text after the agent took it: the transcript says taken, nothing cleared', async () => {
    const { f, deps } = laggy({ staleAfterEnter: true })
    await guardedSend(deps, OURS, opts)
    expect(f.submitted).toEqual([OURS])
    expect(f.keys).not.toContain('ctrl+u')
  })

  it('a later attempt finds its own text left in the field: cleared, typed again, submitted once', async () => {
    const { f, deps } = laggy({ box: OURS })
    await guardedSend(deps, OURS, { ...opts, retry: true })
    expect(f.submitted).toEqual([OURS])
  })

  it('without `retry`, text in the field is never cleared (a draft): refused', async () => {
    const { f, deps } = laggy({ box: OURS })
    await expect(guardedSend(deps, OURS, opts)).rejects.toMatchObject({ code: 'input_busy' })
    expect(f.keys).toEqual([])
    expect((await guardedSend(deps, OURS, opts).catch(e => e)).typed).toBeUndefined()
  })
})

describe('Codex: Enter checked after Herdr’s agent.prompt', () => {
  const codex = (o: Parameters<typeof laggy>[0] = {}) => {
    const l = laggy(o)
    // Herdr typed it and pressed Enter (lost or not).
    l.f.set(OURS)
    return l
  }
  it('field emptied: taken, nothing more pressed', async () => {
    const { f, deps } = codex()
    f.set('')
    await confirmSubmitted(deps, OURS, opts)
    expect(f.keys).toEqual([])
  })

  it('Enter dropped once: pressed again, taken', async () => {
    const { f, deps } = codex()
    await confirmSubmitted(deps, OURS, opts)
    expect(f.keys).toEqual(['enter'])
    expect(f.submitted).toEqual([OURS])
  })

  it('never taken: our text taken out of the field, not submitted (typed)', async () => {
    const { f, deps, view } = codex({ loseEnters: 9 })
    await expect(confirmSubmitted(deps, OURS, opts)).rejects.toMatchObject({ code: 'not_submitted', typed: true })
    expect(f.keys.filter(k => k === 'enter')).toHaveLength(1)
    expect(view()).toBe('')
  })

  it('a long text wraps: its first line is enough to know it is ours', async () => {
    const long = 'word '.repeat(60).trim()
    const { f, deps, view } = laggy({ loseEnters: 9 })
    f.set(long.slice(0, 70))
    await expect(confirmSubmitted(deps, long, opts)).rejects.toMatchObject({ code: 'not_submitted' })
    expect(view()).toBe('')
  })

  it('someone else’s text in the field: not ours, never cleared', async () => {
    const { f, deps } = laggy({ box: 'a draft of mine' })
    await confirmSubmitted(deps, OURS, opts)
    expect(f.keys).toEqual([])
  })

  it('transcript already has it while the screen still shows it: taken', async () => {
    const { f, deps } = codex({ loseEnters: 9 })
    f.submitted.push(OURS)
    await confirmSubmitted(deps, OURS, opts)
    expect(f.keys).not.toContain('ctrl+u')
  })
})

describe('message held for the end of the turn', () => {
  const T0 = Date.parse('2026-10-20T10:00:00Z')
  const held = (more: Partial<QueueEntry> = {}): QueueEntry => ({ id: 'w-a', text: OURS, at: T0, held: true, turn: true, typedAt: T0, ...more })

  it('shown as queued until the turn ends, with its reason', () => {
    expect(publicEntry(held())).toEqual({ id: 'w-a', text: OURS, at: T0, state: 'held', reason: 'turn' })
    // Waiting for a free field wins over the turn.
    expect(publicEntry(held({ busy: true })).reason).toBe('busy')
  })

  it('never "Not sent" while the turn goes on, however long', () => {
    const list = [held()]
    expect(checkQueue(list, 'working', T0 + 3 * HOLD_TTL_MS)).toBe(false)
    expect(list[0]!.failed).toBeUndefined()
    // The turn ends: counted from then on.
    expect(checkQueue(list, 'idle', T0 + 3 * HOLD_TTL_MS + 1000, false)).toBe(false)
    expect(list[0]!.failed).toBeUndefined()
    expect(checkQueue(list, 'working', T0 + 3 * HOLD_TTL_MS + 2000)).toBe(false)
    expect(list[0]!.readySince).toBeUndefined()
  })

  it('kept across a restart of wherdr, with the moment it was typed', () => {
    expect(loadQueued({ 'w1:p1': [held()] }, T0 + 1000)).toEqual([['w1:p1', [held()]]])
  })
})

describe('delivery read from the transcript (as herdr-projects’ said_to)', () => {
  const T0 = Date.parse('2026-10-20T10:00:00Z')
  const iso = (ms: number) => new Date(ms).toISOString()
  const q = { text: OURS, at: T0 + 30000, typedAt: T0 }

  it('the agent took it late: its words in a user message written since it was typed', () => {
    // Claude's queued_command keeps the time the message was queued.
    const items: ChatItem[] = [{ role: 'user', text: OURS, ts: iso(T0 + 200) }]
    expect(landed(q, items, T0 + 60000, 'claude')).toBe(true)
  })

  it('not there: still not delivered, even when another message got a reply since', () => {
    const items: ChatItem[] = [
      { role: 'user', text: 'something else', ts: iso(T0 + 1000) },
      { role: 'assistant', text: 'ok', ts: iso(T0 + 2000) },
    ]
    expect(landed(q, items, T0 + 60000, 'claude')).toBe(false)
  })

  it('the same words said long before it was typed do not count', () => {
    const items: ChatItem[] = [{ role: 'user', text: OURS, ts: iso(T0 - 3600000) }]
    expect(landed(q, items, T0 + 60000, 'claude')).toBe(false)
  })
})

describe('app: a "Not sent" bubble the server got after all', () => {
  const T0 = Date.parse('2026-10-20T10:00:00Z')
  it('goes as soon as the server lists the message, and does not come back once it lands', () => {
    let box = failLocal(addSending([], 'w-a', OURS, T0), 'w-a')
    // The answer to the request was lost, but the server has the message.
    box = prune(box, [{ id: 'w-a', text: OURS, at: T0 + 100 }], T0 + 2000)
    expect(box).toEqual([])
    // Landed: the server drops it, nothing shows any more.
    expect(withOutbox([], prune(box, [], T0 + 9000))).toEqual([])
  })

  it('a bubble the server never got stays "Not sent", with Retry', () => {
    const box = prune(failLocal(addSending([], 'w-a', OURS, T0), 'w-a'), [], T0 + 60000)
    expect(box).toEqual([expect.objectContaining({ id: 'w-a', state: 'failed', local: true })])
  })
})
