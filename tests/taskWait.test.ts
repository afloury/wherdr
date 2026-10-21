// Queue and "Start after…": the board's slots, a task's wait as `details`
// gives it, the tasks to wait for and how they are named.
import { describe, expect, it, vi } from 'vitest'
import { type MachineTasks, afterRef, boardLabel, cleanAfterRefs, clearAfterArgs, delegateArgs, detailsFromTaskFile, parseBoardAgents, parseTaskDetails, parseTaskRow, slotsOf, startPlace } from '../shared/projectsTasks'
import { queuePlaceText, typedRef, waitChoices, waitName } from '../app/utils/taskWait'

// The language, as the device's setting would give it.
const lang = vi.hoisted(() => ({ fr: false }))
vi.mock('../app/utils/i18n', () => ({ tl: (en: string, fr: string) => (lang.fr ? fr : en) }))

const row = (fields: Record<string, unknown>) => ({ ...parseTaskRow({ title: 'x', ...fields })! })

describe('the board\'s slots', () => {
  const rows = [
    row({ id: 'demo/1', state: 'working', stage: 'working' }),
    row({ id: 'demo/2', state: 'working', stage: 'reviewing' }),
    row({ id: 'demo/3', state: 'working', stage: 'queued', queue: 1 }),
    row({ id: 'demo/4', state: 'working', stage: 'after' }),
    row({ id: 'demo/5', state: 'idle', stage: 'todo' }),
    row({ id: 'demo/6', state: 'done', stage: 'done' }),
    row({ id: 'demo/7', state: 'working', stage: 'working', archivedAt: 1 }),
  ]
  it('counts the tasks in a slot stage and those queued for one', () => {
    expect(slotsOf(rows, 2)).toEqual({ max: 2, busy: 2, waiting: 1 })
  })
  it('Queue when every slot is taken, at the place after those waiting; Start otherwise', () => {
    expect(startPlace({ max: 2, busy: 2, waiting: 1 })).toBe(2)
    expect(startPlace({ max: 2, busy: 3, waiting: 0 })).toBe(1)
    expect(startPlace({ max: 2, busy: 1, waiting: 4 })).toBeNull()
    expect(startPlace(null)).toBeNull()
  })
  it('reads board.agents from show --json', () => {
    const show = (value: unknown) => JSON.stringify({ settings: [{ name: 'worker.agent', value: 'claude' }, { name: 'board.agents', value }] })
    expect(parseBoardAgents(show(2))).toBe(2)
    expect(parseBoardAgents(show('3'))).toBe(3)
    for (const bad of [0, -1, 1.5, 'many', null]) expect(parseBoardAgents(show(bad))).toBeNull()
    expect(parseBoardAgents('not json')).toBeNull()
    expect(parseBoardAgents(JSON.stringify({ settings: [] }))).toBeNull()
  })
  it('says the place in words', () => {
    lang.fr = false
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 103].map(queuePlaceText)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '103rd'].map(n => `${n} in the queue`))
    lang.fr = true
    expect([1, 3].map(queuePlaceText)).toEqual(['1re dans la file', '3e dans la file'])
    lang.fr = false
  })
})

describe('a task\'s wait, from details', () => {
  // 1.2.1 finish_line.rs: `after` and `queue` blocks.
  const details = (extra: Record<string, unknown>) => parseTaskDetails(JSON.stringify({ task: { id: 'demo/9', stage: 'after' }, ...extra }))
  it('reads what it waits for, what is left, and why it waits for you', () => {
    const d = details({ after: {
      waitsFor: ['demo/3', 'vm-str:ela/3'], waiting: true, left: ['vm-str:ela/3'], waitsForYou: null,
      tasks: [{ id: 'demo/3', title: 'Login', done: true }, { id: 'vm-str:ela/3', title: 'API' }],
    } })
    expect(d.after).toEqual({ waitsFor: ['demo/3', 'vm-str:ela/3'], left: ['vm-str:ela/3'], waiting: true, forYou: '', titles: { 'demo/3': 'Login', 'vm-str:ela/3': 'API' } })
    expect(details({ after: { waitsFor: ['demo/3'], waiting: true, left: ['demo/3'], waitsForYou: 'DEMO-3 failed' } }).after?.forYou).toBe('DEMO-3 failed')
  })
  it('not delegated yet: all of them are to wait for', () => {
    expect(details({ after: { waitsFor: ['demo/3'], waiting: false, left: null } }).after).toMatchObject({ waiting: false, left: ['demo/3'] })
  })
  it('nothing to wait for, or ids it cannot read: no wait', () => {
    expect(details({}).after).toBeNull()
    expect(details({ after: { waitsFor: [] } }).after).toBeNull()
    expect(details({ after: { waitsFor: ['--now', '../x'] } }).after).toBeNull()
  })
  it('reads its place in the queue', () => {
    expect(details({ queue: { place: 3, words: 'waiting for a free slot, Q#3' } }).queue).toBe(3)
    expect(details({ queue: { place: 0 } }).queue).toBeNull()
    expect(details({}).queue).toBeNull()
  })
  it('from a task file (wherdr in a container)', () => {
    expect(detailsFromTaskFile({ id: 'demo/9', stage: 'after', after: ['demo/3', 'demo/4'], afterLeft: ['demo/4'], afterBlocked: null })?.after)
      .toMatchObject({ waitsFor: ['demo/3', 'demo/4'], left: ['demo/4'], waiting: true })
    expect(detailsFromTaskFile({ id: 'demo/9', stage: 'todo', after: ['demo/3'] })?.after).toMatchObject({ waiting: false, left: ['demo/3'] })
    expect(detailsFromTaskFile({ id: 'demo/9', stage: 'todo' })?.after).toBeNull()
  })
})

describe('the tasks to wait for', () => {
  it('takes ids and keys, with another machine\'s label first; nothing else', () => {
    expect(cleanAfterRefs(['DEMO-3', 'demo/4', 'vm-str:ELA-3', 'vm-str:ela/3', 'DEMO-3'])).toEqual(['DEMO-3', 'demo/4', 'vm-str:ELA-3', 'vm-str:ela/3'])
    for (const bad of [[], ['--now'], ['DEMO-3,DEMO-4'], ['DEMO-3 x'], ['#3'], [':DEMO-3'], 'DEMO-3', null, [3]]) expect(cleanAfterRefs(bad)).toBeNull()
    expect(cleanAfterRefs(Array.from({ length: 21 }, (_, i) => `DEMO-${i + 1}`))).toBeNull()
  })
  it('delegate --after and after --clear, the id after --', () => {
    expect(delegateArgs('demo/5', null, ['DEMO-3', 'vm-str:ELA-3'])).toEqual(['delegate', '--after=DEMO-3,vm-str:ELA-3', '--', 'demo/5'])
    expect(delegateArgs('demo/5', 'codex', [])).toEqual(['delegate', '--worker.agent=codex', '--', 'demo/5'])
    expect(clearAfterArgs('demo/5')).toEqual(['after', '--clear', '--', 'demo/5'])
  })
  it('names a machine as herdr-projects does', () => {
    expect(boardLabel('vm-str.example.ts.net')).toBe('vm-str')
    expect(boardLabel('me@build box')).toBe('build-box')
    expect(afterRef('demo/3', 'DEMO')).toBe('DEMO-3')
    expect(afterRef('demo/3', null, 'vm-str.example')).toBe('vm-str:demo/3')
    expect(afterRef('ela/3', 'ELA', 'vm-str')).toBe('vm-str:ELA-3')
  })

  const machines: MachineTasks[] = [
    { machine: 'far1', status: 'ready', version: '1.2.1', tasks: [
      { ...row({ id: 'ela/3', state: 'working', stage: 'working', title: 'API endpoint' }), repoKey: 'ELA' },
      { ...row({ id: 'ela/4', state: 'done', stage: 'done', title: 'Done there' }), repoKey: 'ELA' },
    ] },
    { machine: '', status: 'ready', version: '1.2.1', tasks: [
      { ...row({ id: 'demo/5', state: 'idle', stage: 'todo', title: 'Dark mode' }), repoKey: 'DEMO' },
      { ...row({ id: 'demo/6', state: 'working', stage: 'working', title: 'Login page' }), repoKey: 'DEMO' },
      { ...row({ id: 'demo/7', state: 'idle', stage: 'todo', title: 'Archived one', archivedAt: 1 }), repoKey: 'DEMO' },
      { ...row({ id: 'docs/2', state: 'idle', stage: 'todo', title: 'Write the guide' }) },
    ] },
    { machine: 'gone', status: 'error', version: '', tasks: [row({ id: 'x/1', state: 'idle', stage: 'todo' })] },
  ]
  const labelOf = (k: string) => (k === 'far1' ? 'vm-str.example.ts.net' : k === '' ? 'devbox' : k)
  it('offers every machine\'s tasks, its own first, not itself, done, archived or unreadable', () => {
    expect(waitChoices(machines, '', 'demo/5', labelOf).map(c => c.ref)).toEqual(['DEMO-6', 'docs/2', 'vm-str:ELA-3'])
  })
  it('finds them by key, id, number or title', () => {
    expect(waitChoices(machines, '', 'demo/5', labelOf, 'demo-6').map(c => c.ref)).toEqual(['DEMO-6'])
    expect(waitChoices(machines, '', 'demo/5', labelOf, 'GUIDE').map(c => c.ref)).toEqual(['docs/2'])
    expect(waitChoices(machines, '', 'demo/5', labelOf, 'vm-str').map(c => c.ref)).toEqual(['vm-str:ELA-3'])
    expect(waitChoices(machines, '', 'demo/5', labelOf, '#3').map(c => c.ref)).toEqual(['vm-str:ELA-3'])
  })
  it('from another machine\'s task, this one\'s are named with its label', () => {
    expect(waitChoices(machines, 'far1', 'ela/3', labelOf).map(c => c.ref)).toEqual(['devbox:DEMO-6', 'devbox:DEMO-5', 'devbox:docs/2'])
  })
  it('a typed id the board can read is offered as it is', () => {
    expect(typedRef(' vm-str:ELA-9 ')).toBe('vm-str:ELA-9')
    expect(typedRef('dark mode')).toBeNull()
    expect(typedRef('')).toBeNull()
  })
  it('names the tasks a wait names by their key', () => {
    expect(waitName('demo/6', '', machines, labelOf)).toBe('DEMO-6')
    expect(waitName('docs/2', '', machines, labelOf)).toBe('docs/2')
    expect(waitName('vm-str:ela/3', '', machines, labelOf)).toBe('vm-str:ELA-3')
    expect(waitName('other:ela/3', '', machines, labelOf)).toBe('other:ela/3')
  })
})
