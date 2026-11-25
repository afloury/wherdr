import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPmStore, type PmStore } from '../server/utils/pmStore'
import { frameInput, hhmm, noticeLines, saidOf, typed, userActedOn, userRepliedTo } from '../server/utils/pmReply'
import { coordinatorsView } from '../server/utils/pmCoordinator'
import { wakeTick } from '../server/utils/pmWakes'
import { MAIN } from '../shared/pm/coordinator'
import { ELSEWHERE_KEPT, ELSEWHERE_MAX_AGE, answeredElsewhere, noticeText, recordElsewhere, repliedOpen, type Elsewhere } from '../shared/pm/elsewhere'
import { proposalMoot } from '../shared/pm/proposalMoot'
import { cardOf } from '../shared/pm/board'
import { enqueue } from '../shared/pm/wakes'
import { planSteps, type StepState } from '../shared/pm/steps'
import { common, company } from '../shared/pm/examples'
import type { Run } from '../shared/pm/run'
import type { Template } from '../shared/pm/workflow'

let dir = '', store: PmStore
const NOW = Date.now()
const state = (at: number): StepState => ({ at, started: true, proofs: {}, rounds: {} })
const run = (task: string, over: Partial<Run> = {}): Run => ({ id: `r-${task}-${over.role ?? 'worker'}`, task, role: 'worker', program: 'claude', model: 'm', machine: '', worktree: '/w', branch: 'b', instructions: 'i', terminal: 'host/t1', attempt: 1, state: 'running', startedAt: 1, ...over })

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-reply-'))
  store = createPmStore(dir)
  await store.setEnabled(true)
  await store.saveTemplate(company)
  await store.saveTemplate(common)
  await fs.writeFile(store.files.projects, JSON.stringify({ v: 1, projects: [{ key: 'CO', name: 'Company', machine: '', path: '/src/co', template: 'company', addedAt: 1 }] }))
  await store.saveCoordinator({ project: 'CO', tokenHash: '', terminal: 'host/co' })
  await store.saveCoordinator({ project: MAIN, tokenHash: '', terminal: 'host/alfred' })
})
afterEach(() => fs.rm(dir, { recursive: true, force: true }))

const working = async () => {
  const task = await store.addTask({ project: 'CO', title: 'Fix', type: 'feature' })
  await store.saveTask({ ...task, state: 'working', step: state(1) })
  await store.saveRun(run(task.id))
  return task.id
}

describe('the user answers a task\'s agent in its session', () => {
  it('logs one line by the user, saves the reply, and leaves the step, state and labels alone', async () => {
    const id = await working()
    const before = (await store.task(id))!
    expect(await userRepliedTo(store, 'host/t1', `  Use the\n  second   option, please ${'x'.repeat(200)}`, NOW)).toBe(true)
    const after = (await store.task(id))!
    expect(after.log!.at(-1)).toMatchObject({ by: 'user', text: expect.stringMatching(/^you replied to the worker: Use the second option, please x+…$/) })
    expect(after.log!.at(-1)!.text.slice('you replied to the worker: '.length)).toHaveLength(80)
    expect(after.replied).toMatchObject({ at: NOW, role: 'worker', said: expect.stringMatching(/^Use the second option/) })
    expect({ ...after, replied: undefined, log: undefined }).toEqual({ ...before, replied: undefined, log: undefined })
  })

  it('names the reviewer', async () => {
    const id = await working()
    await store.saveRun(run(id, { role: 'reviewer', terminal: 'host/t2' }))
    await userRepliedTo(store, 'host/t2', 'looks fine', NOW)
    expect((await store.task(id))!.log!.at(-1)!.text).toBe('you replied to the reviewer: looks fine')
    expect((await store.task(id))!.replied!.role).toBe('reviewer')
  })

  it('only a live worker or reviewer run of a task: not an ended run, a coordinator, an unknown terminal or an empty line', async () => {
    const id = await working()
    await store.saveRun(run(id, { role: 'reviewer', terminal: 'host/t2', state: 'ended' }))
    expect(await userRepliedTo(store, 'host/t2', 'hi', NOW)).toBe(false)
    expect(await userRepliedTo(store, 'host/co', 'hi', NOW)).toBe(false)
    expect(await userRepliedTo(store, 'host/alfred', 'hi', NOW)).toBe(false)
    expect(await userRepliedTo(store, 'host/none', 'hi', NOW)).toBe(false)
    expect(await userRepliedTo(store, undefined, 'hi', NOW)).toBe(false)
    expect(await userRepliedTo(store, 'host/t1', '  \n ', NOW)).toBe(false)
    expect((await store.task(id))!.replied).toBeUndefined()
    expect((await store.task(id))!.log?.some(l => l.by === 'user')).toBeFalsy()
  })

  it('shows on the card, and goes once the agent reports, gives a verdict or asks something new after it', async () => {
    const id = await working()
    await userRepliedTo(store, 'host/t1', 'go on', NOW)
    const plan = planSteps(company, { type: 'feature' })
    const task = (await store.task(id))!
    expect(cardOf(task, plan, [], NOW).replied).toEqual({ at: NOW, role: 'worker', said: 'go on' })
    expect(task.replied!.seen).toBeDefined()
    expect(repliedOpen({ ...task, workReports: [{ step: 'work', text: 'done' }] })).toBeUndefined()
    expect(repliedOpen({ ...task, step: { ...task.step!, reviews: { review: [{ findings: [] }] } } })).toBeUndefined()
    expect(repliedOpen({ ...task, work: { commits: 'c', files: [], reviewed: 'abc' } })).toBeUndefined()
    expect(repliedOpen({ ...task, question: 'Which one?' })).toBeUndefined()
    expect(cardOf({ ...task, workReports: [{ step: 'work', text: 'done' }] }, plan, [], NOW).replied).toBeUndefined()
    // The same still-open question it was answered on is no new one.
    const asked = { ...task, question: 'Which one?' }
    const again = { ...asked, replied: { ...asked.replied!, seen: { ...asked.replied!.seen!, question: `${'Which one?'.length}:Which one?` } } }
    expect(repliedOpen(again)).toBeDefined()
    expect(repliedOpen({ ...again, question: 'Another thing entirely?' })).toBeUndefined()
  })

  it('tells the task\'s coordinator and Alfred, each in its own list', async () => {
    const id = await working()
    await userRepliedTo(store, 'host/t1', 'go on', NOW)
    for (const key of ['CO', MAIN]) expect((await store.coordinator(key))!.elsewhere).toEqual([{ task: id, shown: id, at: NOW, what: 'reply', role: 'worker', said: 'go on', ...(key === 'CO' ? { woken: true } : {}) }])
    const view = await coordinatorsView(store)
    expect(view.find(v => v.project === 'CO')!.elsewhere).toHaveLength(1)
    expect(view.find(v => v.main)!.elsewhere).toHaveLength(1)
  })

  it('a project without a coordinator record gets none made; Alfred still hears', async () => {
    await fs.rm(path.join(path.dirname(store.files.projects), 'coordinators', 'CO.json'))
    const id = await working()
    await userRepliedTo(store, 'host/t1', 'go on', NOW)
    expect(await store.coordinator('CO')).toBeNull()
    expect((await store.coordinator(MAIN))!.elsewhere).toHaveLength(1)
    expect(id).toBeTruthy()
  })

  it('the step button is an entry too (no log, no reply)', async () => {
    const id = await working()
    await userActedOn(store, id, 'step', NOW)
    expect((await store.coordinator('CO'))!.elsewhere!.map(e => e.what)).toEqual(['step'])
    expect((await store.task(id))!.replied).toBeUndefined()
    await userActedOn(store, 'CO-99', 'step', NOW)
    expect((await store.coordinator('CO'))!.elsewhere).toHaveLength(1)
  })
})

describe('the coordinator\'s next wake', () => {
  const deliver = (now: number) => {
    const sent: string[] = []
    const call = async (method: string, params: Record<string, string>) => {
      if (method === 'terminal.get') return { status: 'idle' }
      if (method === 'terminal.send') sent.push(params.text!)
      return {}
    }
    return { sent, run: () => wakeTick({ store, call, machines: () => [] } as unknown as Parameters<typeof wakeTick>[0], now) }
  }

  it('the task\'s own coordinator is woken by a reply (no notice repeats it); Alfred hears it in its next wake', async () => {
    const id = await working()
    await userRepliedTo(store, 'host/t1', 'take the second option', NOW)
    const [w] = await store.wakes(NOW)
    expect(w).toMatchObject({ coordinator: 'CO', kind: 'reply', about: `${id} (reply)`, reasons: [`You replied to ${id}'s worker at ${hhmm(NOW)}: take the second option`] })
    expect((await store.coordinator('CO'))!.elsewhere![0]!.woken).toBe(true)
    expect((await store.coordinator(MAIN))!.elsewhere![0]!.woken).toBeUndefined()
    const co = deliver(NOW + 20_000)
    expect(await co.run()).toEqual(['CO'])
    expect(co.sent[0]).toMatch(/^Reply: .*wake /)
    expect(co.sent[0]).toContain(`You replied to ${id}'s worker at ${hhmm(NOW)}: take the second option`)
    expect(co.sent[0]).not.toContain('replied directly')
    await store.saveWakes([enqueue([], MAIN, ['hello'], NOW + 30_000, 'm1', true)])
    const al = deliver(NOW + 31_000)
    await al.run()
    expect(al.sent.find(x => x.includes('hello'))).toContain(`User replied directly to ${id}'s worker at ${hhmm(NOW)}: take the second option`)
  })

  it('replies within a minute are one wake, sent once the user has paused; never later than a minute after the first', async () => {
    const id = await working()
    await userRepliedTo(store, 'host/t1', 'first', NOW)
    await userRepliedTo(store, 'host/t1', 'second', NOW + 10_000)
    expect((await store.wakes(NOW))).toHaveLength(1)
    const early = deliver(NOW + 20_000)
    expect(await early.run()).toEqual([])
    const ok = deliver(NOW + 26_000)
    expect(await ok.run()).toEqual(['CO'])
    expect(ok.sent[0]).toContain(': first')
    expect(ok.sent[0]).toContain(': second')
    // Kept replying: the first still goes a minute after itself.
    await userRepliedTo(store, 'host/t1', 'third', NOW + 100_000)
    await userRepliedTo(store, 'host/t1', 'fourth', NOW + 150_000)
    const [w] = (await store.wakes(NOW)).filter(x => !x.deliveredAt)
    expect(w!.after).toBe(NOW + 160_000)
    expect(id).toBeTruthy()
  })

  it('wakes again with the agent\'s answer once, when it next reports', async () => {
    const id = await working()
    await userRepliedTo(store, 'host/t1', 'use B', NOW)
    await deliver(NOW + 20_000).run()
    const run = (now: number) => wakeTick({ store, call: async () => ({}), machines: () => [] } as unknown as Parameters<typeof wakeTick>[0], now)
    await run(NOW + 30_000)
    expect((await store.wakes(NOW)).filter(x => !x.deliveredAt)).toEqual([])
    const t = (await store.task(id))!
    await store.saveTask({ ...t, workReports: [{ step: 'work', text: 'Done with B.\nAll tests pass.' }] })
    await run(NOW + 40_000)
    const pending = (await store.wakes(NOW)).filter(x => !x.deliveredAt)
    expect(pending).toHaveLength(1)
    expect(pending[0]!.reasons).toEqual([`${id}'s worker answered: Done with B. All tests pass.`])
    expect((await store.task(id))!.replied!.told).toBe(true)
    await run(NOW + 50_000)
    expect((await store.wakes(NOW)).filter(x => !x.deliveredAt)).toHaveLength(1)
  })

  it('never wakes for the coordinator\'s own message (no run behind its terminal)', async () => {
    await working()
    expect(await userRepliedTo(store, 'host/co', 'tell the worker', NOW)).toBe(false)
    expect(await store.wakes(NOW)).toEqual([])
  })

  it('no wake when the coordinator is not running; the step button never wakes', async () => {
    const id = await working()
    await store.saveCoordinator({ project: 'CO', tokenHash: '' })
    await userRepliedTo(store, 'host/t1', 'x', NOW)
    await userActedOn(store, id, 'step', NOW)
    expect(await store.wakes(NOW)).toEqual([])
  })

  it('Alfred gets the notice in its own list, whatever the task', async () => {
    const id = await working()
    await userActedOn(store, id, 'step', NOW)
    await store.saveWakes([enqueue([], MAIN, ['hello'], NOW + 1000, 'm1', true)])
    const d = deliver(NOW + 2000)
    expect(await d.run()).toEqual([MAIN])
    expect(d.sent[0]).toContain(`User acted on ${id}'s step themselves at ${hhmm(NOW)}`)
  })

  it('lists at most ten, the rest counted', () => {
    const list: Elsewhere[] = Array.from({ length: 12 }, (_, i) => ({ task: 'CO-1', shown: 'CO-1', at: i + 1, what: 'step' as const }))
    const lines = noticeLines(list, 1)
    expect(lines).toHaveLength(11)
    expect(lines.at(-1)).toContain('and 1 more')
    expect(noticeLines(list, 12)).toEqual([])
    expect(noticeLines(undefined)).toEqual([])
  })
})

describe('the entries kept', () => {
  const e = (at: number, task = 'CO-1'): Elsewhere => ({ task, shown: task, at, what: 'reply', role: 'worker', said: 'x' })
  it('keeps the last 50 and drops those older than 7 days', () => {
    let list: Elsewhere[] = []
    for (let i = 0; i < 60; i++) list = recordElsewhere(list, e(1000 + i), 1000 + i)
    expect(list).toHaveLength(ELSEWHERE_KEPT)
    expect(list[0]!.at).toBe(1010)
    expect(recordElsewhere(list, e(ELSEWHERE_MAX_AGE + 2000), ELSEWHERE_MAX_AGE + 2000).map(x => x.at)).toEqual([ELSEWHERE_MAX_AGE + 2000])
  })
  it('the view drops the expired ones too', async () => {
    const old = e(NOW - ELSEWHERE_MAX_AGE - 1000)
    await store.saveCoordinator({ ...(await store.coordinator('CO'))!, elsewhere: [old, e(NOW - 1000)] })
    expect((await coordinatorsView(store)).find(v => v.project === 'CO')!.elsewhere).toEqual([e(NOW - 1000)])
  })
  it('words each notice', () => {
    expect(noticeText({ ...e(1), shown: 'SRC-46' }, '14:05')).toBe('User replied directly to SRC-46\'s worker at 14:05: x')
    expect(noticeText({ task: 'A-1', shown: 'A-1', at: 1, what: 'reply', role: 'reviewer' }, '09:00')).toBe('User replied directly to A-1\'s reviewer at 09:00')
    expect(noticeText({ task: 'A-1', shown: 'A-1', at: 1, what: 'step' }, '09:00')).toContain('A-1')
  })
})

describe('the card matcher', () => {
  const list: Elsewhere[] = [{ task: 'CP-9', shown: 'CMP-9', at: 100, what: 'step' }]
  it('finds the entry whose shown or stored id is a whole word of the message, and newer than it', () => {
    expect(answeredElsewhere(list, { text: 'Should CMP-9 merge now?', at: 50 })).toBe(list[0])
    expect(answeredElsewhere(list, { text: 'About CP-9: merge?', at: 50 })).toBe(list[0])
    expect(answeredElsewhere(list, { text: 'Should CMP-9 merge now?', at: 100 })).toBeUndefined()
    expect(answeredElsewhere(list, { text: 'CMP-90 and xCMP-9 and cmp-9 and CMP-9x', at: 50 })).toBeUndefined()
    expect(answeredElsewhere([], { text: 'CMP-9', at: 0 })).toBeUndefined()
  })
  it('never counts a reply to the task\'s agent as the card\'s answer', () => {
    const reply: Elsewhere[] = [{ task: 'CP-9', shown: 'CMP-9', at: 100, what: 'reply', role: 'worker', said: 'ok' }]
    expect(answeredElsewhere(reply, { text: 'Should CMP-9 merge now?', at: 50 })).toBeUndefined()
    // a reply newer than a step entry does not hide it either
    const both: Elsewhere[] = [{ task: 'CP-9', shown: 'CMP-9', at: 100, what: 'step' }, { ...reply[0]!, at: 200 }]
    expect(answeredElsewhere(both, { text: 'CMP-9?', at: 50 })).toBe(both[0])
  })
})

describe('the lines the user submits in a terminal', () => {
  const lines = (...chunks: string[]) => chunks.reduce<{ buf: string, lines: string[] }>((s, c) => { const t = typed(s.buf, c); return { buf: t.buf, lines: [...s.lines, ...t.lines] } }, { buf: '', lines: [] }).lines
  it('logs a line once, on Enter, keystroke by keystroke', () => {
    expect(lines('h', 'i', ' ', 't', 'here')).toEqual([])
    expect(lines('h', 'i', ' ', 'there', '\r')).toEqual(['hi there'])
    expect(lines('one\rtwo\r')).toEqual(['one', 'two'])
  })
  it('ignores control sequences, edits with Backspace and clears with Ctrl-U or Ctrl-C', () => {
    expect(lines('\x1b[A\x1b[1;5Cab\x1b[Ic\x7f\x7fx\r')).toEqual(['ax'])
    expect(lines('\x1b[<0;10;5Mhi\x1bOP\r')).toEqual(['hi'])
    expect(lines('draft\x15\r', 'draft\x03\r')).toEqual([])
  })
  it('a bracketed paste is one line with its breaks kept as spaces, sent by Enter', () => {
    expect(lines('\x1b[200~first\nsecond\x1b[201~')).toEqual([])
    expect(lines('\x1b[200~first\nsecond\x1b[201~', '\r')).toEqual(['first second'])
  })
  it('a blank Enter logs nothing', () => { expect(lines('\r', '  \r')).toEqual([]) })
  it('reads the browser\'s frames: text, bytes, pastes and keys', () => {
    expect(frameInput(JSON.stringify({ type: 'terminal.input', text: 'a\r' }))).toBe('a\r')
    expect(frameInput(JSON.stringify({ type: 'terminal.input', bytes: Buffer.from('é\r').toString('base64') }))).toBe('é\r')
    expect(frameInput(JSON.stringify({ type: 'paste', text: '/tmp/x.png' }))).toBe('/tmp/x.png')
    expect(frameInput(JSON.stringify({ type: 'keys', keys: ['enter'] }))).toBe('\r')
    expect(frameInput(JSON.stringify({ type: 'resize', cols: 1 }))).toBeUndefined()
    expect(frameInput('not json')).toBeUndefined()
  })
  it('keeps the first ~80 characters on one line', () => {
    expect(saidOf('a\n\n b')).toBe('a b')
    expect(saidOf('y'.repeat(81))).toHaveLength(80)
    expect(saidOf('y'.repeat(80))).toBe('y'.repeat(80))
  })
})

describe('a proposal already answered elsewhere', () => {
  const base: Template = structuredClone(common)
  const next: Template = structuredClone(common)
  next.taskTypes[Object.keys(next.taskTypes)[0]!]!.steps.push({ id: 'extra' })
  const p = (by?: string) => ({ at: 100, template: next, ...(by ? { by } : {}) })
  it('waits while its change is not made and nobody else saved the workflow', () => {
    expect(proposalMoot(p('CO'), base, [], [], 'CO')).toBeUndefined()
    expect(proposalMoot(p('CO'), base, [{ at: 50, by: 'user' }, { at: 150, by: 'user' }, { at: 160, by: 'coordinator CO' }], [], 'CO')).toBeUndefined()
  })
  it('is moot once its change is already in the workflow', () => {
    expect(proposalMoot(p('CO'), next, [], [], 'CO')).toBe('already applied')
  })
  it('is moot when the workflow was saved since by the other coordinator', () => {
    expect(proposalMoot(p('CO'), base, [{ at: 150, by: 'main coordinator' }], [], 'CO')).toBe('applied through Alfred')
    expect(proposalMoot(p('main'), base, [{ at: 150, by: 'coordinator CO' }], [], 'CO')).toBe('applied through the project\'s coordinator')
    expect(proposalMoot(p('CO'), base, [{ at: 90, by: 'main coordinator' }], [], 'CO')).toBeUndefined()
  })
  it('is moot when its own answer was kept', () => {
    expect(proposalMoot(p('CO'), base, [], [{ outcome: 'accepted', proposedAt: 100 }], 'CO')).toBe('applied elsewhere')
    expect(proposalMoot(p('CO'), base, [], [{ outcome: 'refused', proposedAt: 100 }], 'CO')).toBe('cancelled elsewhere')
    expect(proposalMoot(p('CO'), base, [], [{ outcome: 'replaced', proposedAt: 100 }, { outcome: 'refused', proposedAt: 7 }], 'CO')).toBeUndefined()
  })
  it('shows on the coordinator\'s view', async () => {
    await store.saveWorkflow('CO', company)
    const current = (await store.workflow('CO'))!
    const changed: Template = structuredClone(current)
    changed.taskTypes[Object.keys(changed.taskTypes)[0]!]!.steps.push({ id: 'extra' })
    await store.saveCoordinator({ ...(await store.coordinator('CO'))!, proposal: { template: changed, diff: '', at: NOW, base: current.version ?? 1, by: 'CO' } })
    expect((await coordinatorsView(store)).find(v => v.project === 'CO')!.proposalElsewhere).toBeUndefined()
    await store.saveWorkflow('CO', changed, { by: 'main coordinator' })
    const view = (await coordinatorsView(store)).find(v => v.project === 'CO')!
    expect(view.proposal).toBeDefined()
    expect(view.proposalElsewhere).toMatch(/^(already applied|applied through)/)
  })
})
