// Prompts Claude Code sends itself (CronCreate scheduled tasks, /loop
// wakeups): shown in place as a "Scheduled task", never as the user's
// message waiting in a queue. Lines shaped like Claude Code 2.1.309 writes
// them (fields not read by wherdr left out).
import { describe, expect, it } from 'vitest'
import { parseLines } from '../server/utils/transcripts'
import { inputBox } from '../server/utils/unqueue'
import { parseClaudeSuggestion } from '../server/utils/claudeScreen'
import { pendingQueue } from '../app/utils/pendingQueue'
import { type OutboxItem, SEND_STUCK_MS, addSending, giveUpSending, settle } from '../app/utils/outbox'
import type { ChatItem, ClaudeQueueEntry } from '../shared/types'

const PROMPT = '[Scheduled check every 2 h - not a user message] Reply with just OK, use no tools.'
const j = (o: object) => JSON.stringify(o)
const ts = (m: number, s = 0) => `2026-01-05T10:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.000Z`

const human = (text: string, at: string) => j({ type: 'user', message: { role: 'user', content: text }, timestamp: at, origin: { kind: 'human' } })
const reply = (text: string, at: string) => j({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] }, timestamp: at })
const cron = (at: string) => j({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'CronCreate', input: { cron: '7 */2 * * *', prompt: PROMPT, recurring: true } }] }, timestamp: at })
const turnEnd = (at: string) => j({ type: 'system', subtype: 'turn_duration', timestamp: at })
const enqueue = (text: string, at: string) => j({ type: 'queue-operation', operation: 'enqueue', timestamp: at, content: text })
const dequeue = (at: string) => j({ type: 'queue-operation', operation: 'dequeue', timestamp: at })
const fire = (at: string) => j({ type: 'system', subtype: 'scheduled_task_fire', content: 'Running scheduled task', isMeta: false, timestamp: at, taskId: 'aa66', prompt: PROMPT })
const metaPrompt = (at: string) => j({ type: 'user', message: { role: 'user', content: PROMPT }, isMeta: true, timestamp: at, promptSource: 'system', wakeupSource: 'schedule_wakeup', scheduledTaskId: 'aa66', turnOrigin: 'scheduled' })

const parse = (lines: string[]) => parseLines(lines.join('\n'), 'claude', 0, '/home/user') as ChatItem[] & { queue?: ClaudeQueueEntry[] }

describe('scheduled task in a Claude transcript', () => {
  it('is one "scheduled" item in its place, and leaves the queue (real order of the lines)', () => {
    const items = parse([
      human('Set a check every 2 h', ts(0)), cron(ts(0, 5)), reply('Scheduled.', ts(0, 6)), turnEnd(ts(0, 7)),
      enqueue(PROMPT, ts(7)), dequeue(ts(7)), fire(ts(7)), metaPrompt(ts(7, 1)), reply('OK', ts(7, 4)), turnEnd(ts(7, 5)),
    ])
    expect(items.map(i => i.role)).toEqual(['user', 'tool', 'assistant', 'scheduled', 'assistant'])
    expect(items[3]).toMatchObject({ role: 'scheduled', text: PROMPT, ts: ts(7) })
    expect(items.queue).toEqual([])
  })

  it('never stays in the queue when Claude wrote no dequeue (the stuck "Queued · sending…")', () => {
    const items = parse([enqueue(PROMPT, ts(7)), fire(ts(7)), metaPrompt(ts(7, 1)), reply('OK', ts(7, 4))])
    expect(items.queue).toEqual([])
    expect(items.map(i => i.role)).toEqual(['scheduled', 'assistant'])
  })

  it('a recurring task: each fire in its place, none queued', () => {
    const items = parse([
      enqueue(PROMPT, ts(7)), fire(ts(7)), metaPrompt(ts(7, 1)), reply('OK', ts(7, 4)),
      human('next question', ts(20)), reply('answer', ts(20, 3)),
      enqueue(PROMPT, ts(47)), metaPrompt(ts(47, 1)), reply('OK again', ts(47, 4)),
    ])
    expect(items.map(i => i.role)).toEqual(['scheduled', 'assistant', 'user', 'assistant', 'scheduled', 'assistant'])
    expect(items.queue).toEqual([])
  })

  it('a task fired while the agent works is not the user\'s queued message', () => {
    const items = parse([human('go', ts(0)), cron(ts(0, 5)), enqueue(PROMPT, ts(7)), fire(ts(7)), enqueue('typed on the computer', ts(7, 2))])
    expect(items.queue!.map(q => q.text)).toEqual(['typed on the computer'])
  })

  it('its fire line written before its enqueue line: not queued either', () => {
    const items = parse([fire(ts(7)), enqueue(PROMPT, ts(7)), metaPrompt(ts(7, 1)), reply('OK', ts(7, 4))])
    expect(items.queue).toEqual([])
    expect(items.map(i => i.role)).toEqual(['scheduled', 'assistant'])
  })

  it('the same words typed by the user stay queued: only the task\'s own lines make it a task', () => {
    const cronRun = j({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_2', name: 'CronCreate', input: { cron: '*/5 * * * *', prompt: 'Run the tests' } }] }, timestamp: ts(0) })
    expect(parse([cronRun, enqueue('Run the tests', ts(1))]).queue!.map(q => q.text)).toEqual(['Run the tests'])
    // Typed again while the task's prompt is queued: one entry leaves, the typed one stays.
    const both = parse([enqueue(PROMPT, ts(5)), fire(ts(7)), enqueue(PROMPT, ts(7))])
    expect(both.queue!.map(q => q.ts)).toEqual([ts(5)])
  })

  it('a prompt taken during a turn (queued_command not from a human) is the scheduled item', () => {
    const items = parse([
      cron(ts(0)), enqueue(PROMPT, ts(7)),
      j({ type: 'attachment', attachment: { type: 'queued_command', commandMode: 'prompt', prompt: PROMPT, origin: { kind: 'scheduled' } }, timestamp: ts(7, 1) }),
    ])
    expect(items.queue).toEqual([])
    expect(items.filter(i => i.role === 'scheduled')).toHaveLength(1)
  })

  it('a <scheduled-task> wrapper is the scheduled item, without its tags', () => {
    const items = parse([j({ type: 'user', message: { role: 'user', content: '<scheduled-task name="daily">Check the build</scheduled-task>' }, timestamp: ts(1) })])
    expect(items.map(i => `${i.role}:${i.text}`)).toEqual(['scheduled:Check the build'])
  })

  it('other meta lines stay hidden', () => {
    const items = parse([j({ type: 'user', message: { role: 'user', content: 'Caveat: hidden' }, isMeta: true, timestamp: ts(1) })])
    expect(items).toHaveLength(0)
  })
})

describe('Claude queue entries shown as pending', () => {
  const at = Date.parse(ts(7))
  const entry = (text: string, t = ts(7)): ClaudeQueueEntry => ({ text, ts: t })

  it('an entry whose text the conversation already shows after it is not pending', () => {
    const typed: ChatItem[] = [{ role: 'user', text: 'typed on the computer', ts: ts(7, 1) }]
    expect(pendingQueue({ mine: [], claude: [entry('typed on the computer')], items: typed, screen: null })).toEqual([])
  })

  it('a scheduled task with the same words does not hide a typed entry', () => {
    const items: ChatItem[] = [{ role: 'scheduled', text: 'Run the tests', ts: ts(7, 1) }]
    expect(pendingQueue({ mine: [], claude: [entry('Run the tests')], items, screen: null }).map(q => q.raw)).toEqual(['Run the tests'])
  })

  it('the same text said earlier does not hide a new entry', () => {
    const items: ChatItem[] = [{ role: 'user', text: 'run the tests', ts: ts(1) }]
    expect(pendingQueue({ mine: [], claude: [entry('run the tests')], items, screen: null }).map(q => q.raw)).toEqual(['run the tests'])
  })

  it('agent at rest for a while: Claude\'s entries are stale, wherdr\'s own stay', () => {
    const mine: OutboxItem[] = [{ id: 'w-1', text: 'mine', at, state: 'failed', reason: 'lost' }]
    const list = pendingQueue({ mine, claude: [entry('left over')], items: [], screen: null, resting: true })
    expect(list.map(q => q.id)).toEqual(['w-1'])
  })
})

describe('a send that never answers', () => {
  it('turns "Not sent" (Retry / Cancel), and the server\'s late answer still wins', () => {
    const sending = addSending([], 'w-a', 'hello', 1000)
    const stuck = giveUpSending(sending, 'w-a')
    expect(stuck[0]).toMatchObject({ id: 'w-a', state: 'failed', local: true })
    expect(SEND_STUCK_MS).toBeGreaterThanOrEqual(60_000)
    const late = settle(stuck, 'w-a', { id: 'w-a', text: 'hello', at: 1000 }, 5000)
    expect(late[0]!.local).toBeUndefined()
    expect(late[0]!.state).toBeUndefined()
  })

  it('leaves a bubble already settled or failed as it is', () => {
    const settled: OutboxItem[] = [{ id: 'w-b', text: 'x', at: 1, settledAt: 2 }]
    expect(giveUpSending(settled, 'w-b')).toBe(settled)
  })
})

describe('Claude\'s grayed-out suggestion in the input field', () => {
  const E = '\x1b'
  const rule = `${E}[38;5;244m${'─'.repeat(40)}${E}[39m`
  const screen = (field: string) => [`${E}[38;5;231m● OK${E}[39m`, '', rule, `${E}[0m❯ ${field}`, rule, '  ⏵⏵ auto mode on'].join('\n')

  it('reads as an empty field, not as typed text', () => {
    expect(inputBox(screen(`${E}[2mYes, push the branch${E}[0m`))).toBe('')
    expect(parseClaudeSuggestion(screen(`${E}[2mYes, push the branch${E}[0m`))).toBe('Yes, push the branch')
  })

  it('the "Try …" placeholder too; typed text stays text', () => {
    expect(inputBox(screen(`${E}[2mTry "how does state.ts work?"${E}[0m`))).toBe('')
    expect(inputBox(screen('a draft'))).toBe('a draft')
    expect(parseClaudeSuggestion(screen('a draft'))).toBeNull()
  })
})
