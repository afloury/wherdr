import { describe, expect, it } from 'vitest'
import { placeTask, type Candidate, type Strategy } from '../shared/pm/placement'
import { WEIGHT_DEFAULTS, type Weight } from '../shared/pm/weight'
import { DEFAULT_MEMORY } from '../shared/pm/memory'

const GB = 1024
// A machine with `totalGb` of RAM, `freeGb` free and `cores` cores, running these agents.
const machine = (key: string, totalGb: number, freeGb: number, cores: number, running: Weight[] = [], more: Partial<Candidate> = {}): Candidate => ({
  key, label: key, online: true, settings: DEFAULT_MEMORY, running: running.map(w => WEIGHT_DEFAULTS[w]),
  capacity: { cores, total: totalGb * GB, available: freeGb * GB, swapTotal: 0, swapFree: 0, load1: 0 }, ...more,
})
const place = (weight: Weight, candidates: Candidate[], pinned?: string) => placeTask({ weight, home: 'machine-a', pinned, candidates })

describe('placing a task', () => {
  it('sends heavy work to the strongest machine, keeps light work home when it fits', () => {
    const a = machine('machine-a', 16, 8, 4), b = machine('machine-b', 64, 40, 16)
    expect(place('heavy', [a, b])).toEqual({ machine: 'machine-b' })
    expect(place('light', [a, b])).toEqual({ machine: 'machine-a' })
    expect(place('standard', [a, b])).toEqual({ machine: 'machine-a' })
    // Home full: light work goes where there is room.
    expect(place('light', [machine('machine-a', 16, 2.2, 4), b])).toEqual({ machine: 'machine-b' })
    // Heavy work waits on a busy CPU; light work ignores the load.
    const loaded = machine('machine-b', 64, 40, 16, [], { capacity: { ...b.capacity!, load1: 14 } })
    expect(place('heavy', [a, loaded])).toEqual({ machine: 'machine-a' })
  })

  it('holds with each machine\'s reason, and names where a start that must go goes', () => {
    const r = place('heavy', [
      machine('machine-a', 16, 5, 8),
      machine('machine-b', 32, 30, 8, [], { wait: 'not ready (gh login: logged out)' }),
      machine('machine-c', 16, 12, 8, [], { online: false }),
    ])
    expect(r).toEqual({ hold: 'Waits for room (Heavy to the strongest): heavy (≈3.9 GB) fits nowhere — machine-a: 5.0 GB free; machine-b: not ready (gh login: logged out); machine-c: offline', best: 'machine-a' })
    // The estimates of the agents already started count, though the reading has not caught up.
    expect(place('standard', [machine('machine-a', 8, 7, 8, ['standard', 'standard', 'standard'])])).toMatchObject({ hold: expect.stringContaining('machine-a: 3 agents take ≈5.3 GB of 8.0 GB') })
    expect(place('light', [machine('machine-a', 64, 60, 8, ['light'], { settings: { ...DEFAULT_MEMORY, maxAgents: 1 } })])).toMatchObject({ hold: expect.stringContaining('1 agents (cap 1)') })
    // No cap set: one agent per 1.5 GB of RAM, though memory is left (8 GB: 5).
    expect(place('light', [machine('machine-a', 8, 7, 8, Array(5).fill('light'))])).toMatchObject({ hold: expect.stringContaining('5 agents (cap 5)') })
  })

  it('places the same tasks by each strategy', () => {
    // Home is small and busy; b has the most room, c the largest share free.
    const set = () => [machine('machine-a', 16, 10, 4, ['light']), machine('machine-b', 64, 40, 8), machine('machine-c', 32, 30, 32)]
    const on = (strategy: Strategy, weight: Weight, candidates = set()) => placeTask({ weight, home: 'machine-a', candidates, strategy })
    expect(['light', 'standard', 'heavy'].map(w => on('strongest', w as Weight))).toEqual([{ machine: 'machine-a' }, { machine: 'machine-a' }, { machine: 'machine-b' }])
    expect(['light', 'standard', 'heavy'].map(w => on('balance', w as Weight))).toEqual([{ machine: 'machine-c' }, { machine: 'machine-c' }, { machine: 'machine-c' }])
    expect(['light', 'standard', 'heavy'].map(w => on('home', w as Weight))).toEqual([{ machine: 'machine-a' }, { machine: 'machine-a' }, { machine: 'machine-a' }])
    // Balance spreads a run of starts; home first fills home before the others.
    const fill = (strategy: Strategy) => {
      const candidates = set(), order: string[] = []
      for (let i = 0; i < 8; i++) {
        const r = on(strategy, 'standard', candidates)
        if (!('machine' in r)) break
        candidates.find(c => c.key === r.machine)!.running.push(WEIGHT_DEFAULTS.standard)
        order.push(r.machine)
      }
      return order
    }
    expect(new Set(fill('balance')).size).toBeGreaterThan(1)
    expect(fill('home').slice(0, 2)).toEqual(['machine-a', 'machine-a'])
    // A hold names the strategy.
    expect(on('balance', 'heavy', [machine('machine-a', 8, 2, 4)])).toMatchObject({ hold: expect.stringContaining('Waits for room (Balance the load): heavy') })
  })

  it('never moves a task from its machine', () => {
    const a = machine('machine-a', 16, 2.5, 4), b = machine('machine-b', 64, 40, 16)
    expect(place('light', [b], 'machine-b')).toEqual({ machine: 'machine-b' })
    // Its machine is full or offline: it waits there, though another has room.
    expect(place('standard', [a], 'machine-a')).toMatchObject({ hold: expect.stringContaining('machine-a: 2.5 GB free'), best: 'machine-a' })
    expect(place('standard', [{ ...b, online: false }], 'machine-b')).toEqual({ hold: 'Waits for machine-b (offline)', best: 'machine-b' })
  })

  it('starts a new task elsewhere while the machine asked for is offline, else waits for it', () => {
    const a = machine('machine-a', 16, 8, 4), b = machine('machine-b', 64, 40, 16, [], { online: false })
    const prefer = (candidates: Candidate[]) => placeTask({ weight: 'standard', home: 'machine-a', prefer: 'machine-b', candidates })
    expect(prefer([a, b])).toEqual({ machine: 'machine-a' })
    expect(prefer([machine('machine-a', 16, 2.5, 4), b])).toEqual({ hold: 'Waits for machine-b (offline)', best: 'machine-a' })
    // Online again: it goes there.
    expect(prefer([a, { ...b, online: true }])).toEqual({ machine: 'machine-b' })
  })

  it('keeps automatic starts within each machine\'s available hours', () => {
    const hours = { days: 'weekdays', from: '09:00', to: '19:00' } as const
    const at = (iso: string, weight: Weight = 'standard') => placeTask({ weight, home: 'machine-a', now: new Date(iso), candidates: [
      machine('machine-a', 16, 8, 4), machine('machine-b', 64, 40, 16, [], { settings: { ...DEFAULT_MEMORY, hours } }),
    ] })
    // A Monday at noon: heavy work goes to the strongest; at 18:00 it leaves in an hour, too late for heavy work.
    expect(at('2026-11-09T12:00:00')).toEqual({ machine: 'machine-a' })
    expect(at('2026-11-09T12:00:00', 'heavy')).toEqual({ machine: 'machine-b' })
    expect(at('2026-11-09T18:00:00', 'heavy')).toEqual({ machine: 'machine-a' })
    // Saturday, or a weekday night: away.
    const alone = (iso: string) => placeTask({ weight: 'light', home: 'machine-b', now: new Date(iso), candidates: [machine('machine-b', 64, 40, 16, [], { settings: { ...DEFAULT_MEMORY, hours } })] })
    expect(alone('2026-11-14T12:00:00')).toMatchObject({ hold: expect.stringContaining('machine-b: away (weekdays 09:00-19:00)') })
    expect(alone('2026-11-09T20:00:00')).toMatchObject({ hold: expect.stringContaining('away') })
    // Over midnight: Friday 22:00 to 06:00 covers Saturday 02:00, not Saturday 22:00.
    const night = { days: 'weekdays', from: '22:00', to: '06:00' } as const
    const n = (iso: string) => placeTask({ weight: 'light', home: 'm', now: new Date(iso), candidates: [machine('m', 64, 40, 16, [], { settings: { ...DEFAULT_MEMORY, hours: night } })] })
    expect(n('2026-11-14T02:00:00')).toEqual({ machine: 'm' })
    expect(n('2026-11-14T22:00:00')).toMatchObject({ hold: expect.stringContaining('away') })
  })

  it('runs more tasks on two machines than on one', () => {
    // Starts until nothing fits, each start counted on its machine.
    const fill = (candidates: Candidate[]) => {
      let n = 0
      for (;;) {
        const r = place('standard', candidates)
        if (!('machine' in r)) return n
        candidates.find(c => c.key === r.machine)!.running.push(WEIGHT_DEFAULTS.standard)
        n++
      }
    }
    const one = fill([machine('machine-a', 16, 14, 8)])
    const two = fill([machine('machine-a', 16, 14, 8), machine('machine-b', 16, 14, 8)])
    expect(one).toBe(7)
    expect(two).toBe(14)
  })
})
