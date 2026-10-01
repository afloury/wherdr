import { describe, expect, it } from 'vitest'
import { nextBackgroundKey, parseBackground } from '../shared/interrupt'
import { interruptAgent } from '../server/utils/interruptSeq'
import type { RestartDeps } from '../server/utils/restartSeq'

const RULE = '─'.repeat(40)
const idle = (footer = '  ⏸ manual mode on · ← for agents', above: string[] = []) =>
  ['● Started.', ...above, RULE, '❯ ', RULE, footer].join('\n')

const SHELLS_LIST = (n: number) => [
  '● Started.', RULE, '  Background', `  ${n} active shell${n > 1 ? 's' : ''}`,
  ...Array.from({ length: n }, (_, i) => `  ${i ? ' ' : '❯'} ● for i in $(seq 9); do echo ${i}; sleep 1; done   running`),
  '  ↑/↓ to select · Enter to view · x to stop · Esc to close',
].join('\n')
const NO_TASKS = ['● Started.', RULE, '  Background', '  No tasks currently running', '  ↑/↓ to select · Enter to view · Esc to close'].join('\n')
const AGENTS = (sel: number, hint: string) => [
  '✻ Waiting for 1 background agent to finish', RULE, '❯ ', RULE, `  ${hint}`,
  `${sel === 0 ? '❯' : ' '} ● main`,
  `${sel === 1 ? '❯' : ' '} ◯ general-purpose  Write a story                                   9s · ↑ 1.2k tokens`,
].join('\n')

describe('reading background tasks', () => {
  it('shells reported in the footer', () => {
    const s = parseBackground(idle('  ⏸ manual mode on · 2 shells · ← for agents'))
    expect(s).toMatchObject({ shells: 2, agents: 0, panel: null, canStop: false })
    expect(nextBackgroundKey(s, 0)).toBe('down')
    expect(nextBackgroundKey(s, 2)).toBe(null)
  })
  it('nothing in the background: nothing to do', () => {
    expect(nextBackgroundKey(parseBackground(idle()), 0)).toBe(null)
  })
  it('shell list: x, then Esc when it is empty', () => {
    const s = parseBackground(SHELLS_LIST(2))
    expect(s).toMatchObject({ panel: 'shells', canStop: true })
    expect(nextBackgroundKey(s, 1)).toBe('x')
    expect(nextBackgroundKey(parseBackground(NO_TASKS), 1)).toBe('esc')
  })
  it('detail of a running shell: x', () => {
    const s = parseBackground(['  Shell details', '  Status:   running', '  Runtime:  7s', '  Output:', '  │ 1 │'].join('\n'))
    expect(s).toMatchObject({ panel: 'shell', canStop: true })
  })
  it('background subagent: move down to its line, x, then close', () => {
    expect(parseBackground(AGENTS(-1, '⏸ manual mode on · ← for agents')).agents).toBe(1)
    const top = parseBackground(AGENTS(0, '↑/↓ to select'))
    expect(top).toMatchObject({ panel: 'agents', selected: 0, rows: 2 })
    expect(nextBackgroundKey(top, 1)).toBe('down')
    expect(nextBackgroundKey(parseBackground(AGENTS(1, 'Enter to view · x to stop')), 1)).toBe('x')
    expect(nextBackgroundKey(parseBackground(AGENTS(1, 'Enter to view · x to clear')), 1)).toBe('esc')
  })
  it('old "Waiting for…" line higher up on the screen: ignored', () => {
    const text = ['✻ Waiting for 1 background agent to finish', ...Array.from({ length: 10 }, (_, i) => `ligne ${i}`), RULE, '❯ ', RULE, '  ⏸ manual mode on'].join('\n')
    expect(parseBackground(text).agents).toBe(0)
  })
})

// Simulated agent: reacts to keys like Claude Code in the observed cases.
function fake(o: { kind?: string, escNeeded?: number, shells?: number, bgAgent?: boolean }) {
  let status = 'working'
  let escs = 0
  let shells = o.shells || 0
  let agent = Boolean(o.bgAgent)
  let panel: 'shells' | 'agents' | null = null
  let footerFocus = false
  let sel = 0
  const sent: string[] = []
  let t = 0
  const screen = () => {
    if (panel === 'shells') return shells ? SHELLS_LIST(shells) : NO_TASKS
    if (panel === 'agents') return AGENTS(sel, sel === 1 ? (agent ? 'Enter to view · x to stop' : 'Enter to view · x to clear') : '↑/↓ to select')
    if (agent) return AGENTS(-1, '⏸ manual mode on · ← for agents')
    return idle(shells ? `  ⏸ manual mode on · ${shells} shells` : undefined)
  }
  const refresh = () => { status = agent ? 'working' : (escs >= (o.escNeeded ?? 1) ? 'idle' : 'working') }
  const d: RestartDeps = {
    now: () => t,
    sleep: async (ms) => { t += ms },
    call: async (method, params) => {
      if (method === 'pane.get') return { pane: { agent_status: status } }
      if (method === 'pane.read') return { read: { text: screen() } }
      const k = (params.keys as string[])[0]!
      sent.push(k)
      if (k === 'esc') {
        if (panel) { panel = null; footerFocus = false }
        else escs++
      } else if (k === 'down') {
        if (panel === 'agents') sel = Math.min(1, sel + 1)
        else if (agent) { panel = 'agents'; sel = 0 }
        else if (shells) footerFocus = true
      } else if (k === 'enter' && footerFocus) { panel = 'shells'; footerFocus = false }
      else if (k === 'x') {
        if (panel === 'shells' && shells) shells--
        if (panel === 'agents' && sel === 1) agent = false
      }
      refresh()
      return {}
    },
  }
  return { d, sent, p: { id: 'w1:p1', agent: o.kind || 'claude', status: 'working' as const } }
}

describe('interrupt sequence', () => {
  it('one Escape is enough: only one sent', async () => {
    const f = fake({})
    expect(await interruptAgent(f.d, f.p)).toEqual({ stopped: true, esc: 1, background: 0 })
    expect(f.sent).toEqual(['esc'])
  })
  it('the agent is still working after the first Escape: a second one', async () => {
    const f = fake({ escNeeded: 2 })
    expect(await interruptAgent(f.d, f.p)).toMatchObject({ stopped: true, esc: 2 })
    expect(f.sent).toEqual(['esc', 'esc'])
  })
  it('never more than two Escapes, nor Ctrl+C: the resisting agent is reported', async () => {
    const f = fake({ escNeeded: 9 })
    expect(await interruptAgent(f.d, f.p)).toMatchObject({ stopped: false, esc: 2 })
    expect(f.sent.every(k => k === 'esc')).toBe(true)
  })
  it('background shells: list opened, each stopped, list closed', async () => {
    const f = fake({ shells: 2 })
    expect(await interruptAgent(f.d, f.p)).toMatchObject({ stopped: true, background: 2 })
    expect(f.sent).toEqual(['esc', 'down', 'enter', 'x', 'x', 'esc'])
  })
  it('background subagent: no useless second Escape, agent stopped from its list', async () => {
    const f = fake({ bgAgent: true })
    expect(await interruptAgent(f.d, f.p)).toMatchObject({ stopped: true, esc: 1, background: 1 })
    expect(f.sent).toEqual(['esc', 'down', 'down', 'x', 'esc'])
  })
  it('Codex: Escape only, no background panel', async () => {
    const f = fake({ kind: 'codex', escNeeded: 2, shells: 1 })
    await interruptAgent(f.d, f.p)
    expect(f.sent).toEqual(['esc', 'esc'])
  })
})

describe('subagent already stopped but still listed', () => {
  it('idle agent: we do not reopen the list', async () => {
    const calls: string[] = []
    let t = 0
    const d: RestartDeps = {
      now: () => t,
      sleep: async (ms) => { t += ms },
      call: async (method, params) => {
        if (method === 'pane.get') return { pane: { agent_status: calls.length ? 'idle' : 'working' } }
        if (method === 'pane.read') return { read: { text: AGENTS(-1, '⏸ manual mode on · ← for agents').replace(/^✻.*\n/, '') } }
        calls.push((params.keys as string[])[0]!)
        return {}
      },
    }
    expect(await interruptAgent(d, { id: 'w1:p1', agent: 'claude', status: 'working' })).toMatchObject({ stopped: true, background: 0 })
    expect(calls).toEqual(['esc'])
  })
})
