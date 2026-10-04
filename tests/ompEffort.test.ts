// omp thinking level from wherdr: ⇧⇥ presses on a fake Herdr socket, each
// one moving omp to the next level of its cycle and writing a
// "thinking_level_change" entry (the configured level) to its transcript.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const GLYPH: Record<string, string> = { off: '⦸', auto: '⟳', low: '◔', medium: '◑', high: '◒' }
const fake = vi.hoisted(() => ({
  sent: [] as string[][],
  cycle: ['off', 'auto', 'low', 'medium', 'high'], // a model without xhigh / max
  level: 'medium',
  resolved: null as string | null, // "auto" after a turn: the glyph of the level it chose
  tick: 0,
  frozen: false, // omp ignores the key (subagent view, no thinking)
}))
// Far ahead: the transcript is always newer than wherdr's own record of a change.
const at = () => `2099-01-01T00:00:${String(fake.tick).padStart(2, '0')}.000Z`
const status = () => {
  const shown = fake.level === 'auto' && fake.resolved ? fake.resolved : fake.level
  return ` ok\n π > ${GLYPH[shown]} Opus 5.5 > 🗑 ~/demo > ▶─1%──────\n╰─        ⇧⇥ to change thinking effort`
}

vi.mock('../server/utils/env', () => ({ log: () => {} }))
vi.mock('../server/utils/actions', () => ({ closePanel: async () => false }))
vi.mock('../server/utils/machines', () => ({ machineOfPane: () => null }))
vi.mock('../server/utils/state', () => ({
  READY: new Set(['idle', 'done']),
  findPane: () => ({ id: 'w1:p1', agent: 'omp', status: 'idle' }),
  poll: () => {},
  transcripts: { model: async () => ({ id: 'anthropic/claude-opus-5-5', label: 'Opus 5.5', effort: fake.level, at: at() }) },
}))
vi.mock('../server/utils/herdr', () => ({
  HerdrError: class HerdrError extends Error {
    constructor(public code: string, message: string) { super(message) }
  },
  sleep: async () => {},
  agentPrompt: async () => {},
  herdr: async (method: string, params: Record<string, unknown>) => {
    if (method === 'pane.read') return { read: { text: status() } }
    if (method === 'pane.send_input') {
      const keys = params.keys as string[]
      fake.sent.push(keys)
      if (keys[0] === 'shift+tab' && !fake.frozen) {
        fake.level = fake.cycle[(fake.cycle.indexOf(fake.level) + 1) % fake.cycle.length]!
        fake.resolved = null
        fake.tick++
      }
    }
    return {}
  },
}))

import { listEfforts, setEffort } from '../server/utils/modelctl'

describe('omp thinking level (⇧⇥ cycle)', () => {
  beforeEach(() => {
    Object.assign(fake, { sent: [], level: 'medium', resolved: null, tick: 0, frozen: false })
  })

  it('presses ⇧⇥ until the level is reached, and nothing else', async () => {
    expect((await listEfforts('w1:p1')).current).toBe('medium')
    const r = await setEffort('w1:p1', 'auto')
    expect(fake.sent).toEqual([['shift+tab'], ['shift+tab'], ['shift+tab']])
    expect(fake.level).toBe('auto')
    expect(r).toMatchObject({ label: 'Opus 5.5', effort: 'auto' })
  })

  it('follows the transcript when "auto" already shows the next level\'s glyph', async () => {
    Object.assign(fake, { level: 'auto', resolved: 'low' })
    await setEffort('w1:p1', 'low')
    expect(fake.sent).toEqual([['shift+tab']])
    expect(fake.level).toBe('low')
  })

  it('a level the model lacks: one full turn back to the start, then the list drops it', async () => {
    await expect(setEffort('w1:p1', 'max')).rejects.toMatchObject({ code: 'bad_effort' })
    expect(fake.level).toBe('medium')
    expect(fake.sent).toHaveLength(fake.cycle.length)
    expect((await listEfforts('w1:p1')).levels).toEqual(['off', 'auto', 'low', 'medium', 'high'])
  })

  it('stops at once when omp does not react', async () => {
    fake.frozen = true
    await expect(setEffort('w1:p1', 'high')).rejects.toMatchObject({ code: 'stale' })
    expect(fake.sent).toEqual([['shift+tab']])
  })
})
