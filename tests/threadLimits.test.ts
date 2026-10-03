import { describe, expect, it } from 'vitest'
import { LIMITS_FILE, cleanThreadLimits, limitsFile, limitsSignature, machineSlots, machineSlotsLine, parseLimitInput, threadOfPane } from '../shared/threadLimits'
import { coordinatorRules } from '../shared/projectBoard'
import { reduceSnapshot } from '../server/utils/snapshot'

const machines = [
  { key: '', label: 'Server' },
  { key: 'aaaa1111', label: 'Laptop' },
  { key: 'aaaa1111~test', baseKey: 'aaaa1111', label: 'Laptop · test' },
]

describe('threads of a pane', () => {
  it('reads the open thread from the herdr-projects group token', () => {
    expect(threadOfPane({ hp_group: 'shop!1!4!t-0012', hp_project: 'shop' }, null, 'claude')).toBe('shop/t-0012')
    expect(threadOfPane({ hp_group: 'Docs.v2!1!1!T-0003' }, null, 'codex')).toBe('docs.v2/t-0003')
  })
  it('does not count a coordinator nor a pane detached from its project', () => {
    expect(threadOfPane({ hp_group: 'shop!0!w1:p1', hp_project: 'shop' }, null, 'claude')).toBeNull()
    expect(threadOfPane({ hp_group: '~!0005' }, 'hp-shop-t-0012', 'claude')).toBeNull()
  })
  it('falls back on the pane name only without any group token', () => {
    expect(threadOfPane(undefined, 'hp-shop-t-0012', 'claude')).toBe('shop/t-0012')
    expect(threadOfPane({}, 'hp-shop-t-0012-fix-login', 'codex')).toBe('shop/t-0012')
    expect(threadOfPane({}, 'hp-shop-t-0012', null)).toBeNull()
    expect(threadOfPane({}, 'notes', 'claude')).toBeNull()
  })
  it('is set on panes by the snapshot reducer', () => {
    const s = reduceSnapshot({ panes: [
      { pane_id: 'w1:p1', agent: 'claude', tokens: { hp_group: 'shop!1!4!t-0012', hp_project: 'shop' } },
      { pane_id: 'w1:p2', agent: 'claude', tokens: { hp_group: 'shop!0!w1:p2', hp_project: 'shop' } },
    ] })
    expect(s.panes.map(p => p.hpThread)).toEqual(['shop/t-0012', undefined])
  })
})

describe('slots per machine', () => {
  const panes = [
    { hpThread: 'shop/t-0012' },
    { hpThread: 'docs/t-0003' },
    { hpThread: 'shop/t-0012' }, // second pane of the same thread
    {}, // coordinator or plain agent
    { machine: 'aaaa1111', hpThread: 'shop/t-0013' },
    { machine: 'aaaa1111~test', hpThread: 'blog/t-0001' }, // named session: same machine
  ]
  it('counts the distinct open threads of every project on each machine', () => {
    const slots = machineSlots(panes, machines, { '': 2 })
    expect(slots).toEqual([
      { key: '', label: 'Server', open: 2, max: 2, free: 0, threads: ['docs/t-0003', 'shop/t-0012'] },
      { key: 'aaaa1111', label: 'Laptop', open: 2, max: null, free: null, threads: ['blog/t-0001', 'shop/t-0013'] },
    ])
  })
  it('never gives a negative number of free slots', () => {
    expect(machineSlots(panes, machines, { '': 1 })[0]!.free).toBe(0)
    expect(machineSlots(panes, machines, { aaaa1111: 4 })[1]!.free).toBe(2)
  })
  it('gives the slot of a finished thread back, but not of one just started', () => {
    const now = 10 * 60000
    const slots = machineSlots([
      { hpThread: 'shop/t-0001', agent: 'claude', status: 'done' }, // ready for review
      { hpThread: 'shop/t-0002', agent: 'codex', status: 'idle', bornAt: now - 4 * 60000 }, // waiting on the user
      { hpThread: 'shop/t-0003', agent: 'claude', status: 'idle', bornAt: now - 60000 }, // brief not received yet
      { hpThread: 'shop/t-0004', agent: 'claude', status: 'working' },
      { hpThread: 'shop/t-0005', agent: 'omp', status: 'blocked' },
      { hpThread: 'shop/t-0006', agent: null, status: 'idle' }, // agent not detected yet
      { hpThread: 'shop/t-0004', agent: null, status: 'idle' }, // shell pane of an active thread
    ], machines, { '': 3 }, now)
    expect(slots[0]).toMatchObject({ open: 4, free: 0, threads: ['shop/t-0003', 'shop/t-0004', 'shop/t-0005', 'shop/t-0006'] })
  })
})

describe('saved limits', () => {
  it('keeps whole numbers from 1 to 99 for known machines', () => {
    expect(cleanThreadLimits({ '': 2, aaaa1111: 4, gone: 3, bad: 0, big: 100, half: 1.5, txt: '2' }, ['', 'aaaa1111', 'bad', 'big', 'half', 'txt'])).toEqual({ '': 2, aaaa1111: 4 })
    expect(cleanThreadLimits(null)).toEqual({})
    expect(cleanThreadLimits([2])).toEqual({})
  })
  it('reads the input field: empty means no limit', () => {
    expect(parseLimitInput(' ')).toBeNull()
    expect(parseLimitInput('3')).toBe(3)
    expect(parseLimitInput('0')).toBeUndefined()
    expect(parseLimitInput('two')).toBeUndefined()
  })
})

describe('file for coordinators', () => {
  const slots = machineSlots([{ hpThread: 'shop/t-0012' }], machines, { '': 2 })
  it('names this machine and gives every machine its limit and free slots', () => {
    const f = limitsFile(slots, '', new Date('2026-01-02T03:04:05Z'))
    expect(f.updated).toBe('2026-01-02T03:04:05.000Z')
    expect(f.this).toBe('Server')
    expect(f.machines).toEqual({
      Server: { max: 2, open: 1, free: 1, threads: ['shop/t-0012'] },
      Laptop: { max: null, open: 0, free: null, threads: [] },
    })
    expect(f.note).toContain('herdr-projects overview')
    expect(limitsFile(slots, 'aaaa1111').this).toBe('Laptop')
  })
  it('only changes signature when the content changes', () => {
    const a = limitsFile(slots, '', new Date(1))
    expect(limitsSignature(a)).toBe(limitsSignature(limitsFile(slots, '', new Date(2))))
    expect(limitsSignature(a)).not.toBe(limitsSignature(limitsFile(machineSlots([], machines, { '': 2 }), '', new Date(1))))
  })
  it('is what the coordinator rules tell it to read', () => {
    for (const lang of ['fr', 'en'] as const) {
      const rules = coordinatorRules(lang)
      expect(rules).toContain(LIMITS_FILE)
      expect(rules).toContain('machines[this].free')
      expect(rules).toContain('herdr-projects overview')
    }
  })
})

describe('In queue header', () => {
  it('shows the machine slots, all projects', () => {
    expect(machineSlotsLine({ label: 'Server', open: 1, max: 2 }, 'en')).toBe('1 of 2 thread slots in use on Server (all projects)')
    expect(machineSlotsLine({ label: 'Server', open: 2, max: 2 }, 'en')).toBe('2 of 2 thread slots in use on Server (all projects) · full: the queue waits')
    expect(machineSlotsLine({ label: 'Server', open: 1, max: 1 }, 'en')).toBe('1 of 1 thread slot in use on Server (all projects) · full: the queue waits')
    expect(machineSlotsLine({ label: 'Server', open: 2, max: 3 }, 'fr')).toBe('2 places de thread sur 3 occupées sur Server (tous projets)')
    expect(machineSlotsLine({ label: 'Server', open: 3, max: 3 }, 'fr')).toBe('3 places de thread sur 3 occupées sur Server (tous projets) · pleine : la file attend')
  })
  it('shows nothing without a limit', () => {
    expect(machineSlotsLine(null)).toBeNull()
    expect(machineSlotsLine({ label: 'Server', open: 2, max: 0 })).toBeNull()
  })
})
