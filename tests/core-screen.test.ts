import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createCoreScreens, readCoreScreen } from '../server/utils/coreScreen'
import { coreChoose, type CoreChooseDeps } from '../server/utils/coreChoose'
import { CoreError } from '../server/utils/core'
import type { Pane } from '../shared/types'

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const bash = fx('claude-approve-bash.txt')
const input = '────────────────────\n❯ \n────────────────────\n  ? for shortcuts'
const working = '✻ Pondering… (12s · ↑ 1.2k tokens · esc to interrupt)\n\n' + input
const pane = (id: string, extra: Partial<Pane> = {}) => ({ id, workspace: 'w', coreAddress: `m/${id}`, agent: 'claude', status: 'unknown', ...extra }) as Pane

describe('readCoreScreen', () => {
  it('reads a permission question and derives Your turn when core reports nothing', () => {
    const r = readCoreScreen(bash, 'claude', 'unknown')
    expect(r.status).toBe('blocked')
    expect(r.interaction).toBe('native')
    expect(r.choices?.options.length).toBe(4)
    expect(r.choices?.identity).toBeTruthy()
  })
  it('derives Working from the interrupt hint and the spinner, without reading a question', () => {
    for (const text of [working, '✻ Pondering… (12s)\n' + input]) {
      const r = readCoreScreen(text, 'claude', null)
      expect(r).toMatchObject({ status: 'working', choices: null, interaction: 'working' })
    }
  })
  it('derives Ready at an empty input field', () => {
    expect(readCoreScreen(input, 'claude', null)).toMatchObject({ status: 'idle', interaction: 'input' })
  })
  it('keeps core\'s own status and only adds the question', () => {
    expect(readCoreScreen(bash, 'claude', 'blocked')).toMatchObject({ status: null, interaction: 'native' })
    expect(readCoreScreen(input, 'claude', 'idle')).toMatchObject({ status: null, interaction: 'input' })
  })
  it('stays unknown on an unrecognised screen', () => {
    expect(readCoreScreen('$ ls', 'claude', 'unknown')).toMatchObject({ status: null, choices: null, interaction: 'unknown' })
  })
})

describe('enrich', () => {
  function setup(texts: Record<string, string>, viewed = (_: string) => true) {
    const reads: string[] = []
    let t = 0
    const screens = createCoreScreens({
      call: async (_m, p: any) => { reads.push(p.terminal); if (texts[p.terminal] === undefined) throw new Error('x'); return { text: texts[p.terminal] } },
      viewed, now: () => t,
    })
    return { screens, reads, tick: (ms: number) => { t += ms } }
  }
  it('fills prompt, interaction and status; skips shells and working agents', async () => {
    const { screens, reads } = setup({ 'm/a': bash, 'm/b': input })
    const a = pane('a'), b = pane('b'), shell = pane('s', { agent: null }), busy = pane('w', { status: 'working' })
    await screens.enrich([a, b, shell, busy])
    expect(reads.sort()).toEqual(['m/a', 'm/b'])
    expect(a).toMatchObject({ status: 'blocked', interaction: 'native' })
    expect(a.prompt?.options.length).toBe(4)
    expect(b).toMatchObject({ status: 'idle', interaction: 'input' })
    expect(shell.interaction).toBeUndefined()
    expect(busy.status).toBe('working')
  })
  it('caches reads per viewed / background pace and re-applies them', async () => {
    const { screens, reads, tick } = setup({ 'm/a': bash }, () => false)
    await screens.enrich([pane('a')])
    tick(2000)
    const again = pane('a')
    await screens.enrich([again])
    expect(reads.length).toBe(1)
    expect(again.status).toBe('blocked')
    tick(4000)
    await screens.enrich([pane('a')])
    expect(reads.length).toBe(2)
  })
  it('marks the interaction unknown when the read fails', async () => {
    const ok = { 'm/a': bash }
    const { screens, tick } = setup(ok)
    const a = pane('a')
    await screens.enrich([a])
    delete (ok as Record<string, string>)['m/a']
    tick(2000)
    await screens.enrich([a])
    expect(a.interaction).toBe('unknown')
  })
})

describe('coreChoose', () => {
  function setup(screenText: () => string) {
    const calls: [string, any][] = []
    const p = pane('t1', { status: 'blocked' })
    const d: CoreChooseDeps = {
      call: async (m, params) => { calls.push([m, params]); return {} as never },
      pane: id => (id === 't1' ? p : undefined), panes: () => [p], refresh: () => {},
      read: async () => screenText(), sleep: async () => {},
    }
    return { d, calls }
  }
  const identity = () => readCoreScreen(bash, 'claude', 'blocked').choices!.identity
  it('sends the keys of the chosen option when the question is unchanged', async () => {
    const { d, calls } = setup(() => bash)
    await coreChoose(d, { pane_id: 't1', index: 1, label: readCoreScreen(bash, 'claude', 'blocked').choices!.options[1]!.label, identity: identity() })
    expect(calls).toEqual([['terminal.keys', { terminal: 'm/t1', keys: ['down', 'enter'] }]])
  })
  it('refuses a changed question or label, and sends nothing', async () => {
    const { d, calls } = setup(() => input)
    await expect(coreChoose(d, { pane_id: 't1', index: 0, label: 'Yes', identity: identity() })).rejects.toMatchObject({ code: 'stale' })
    const same = setup(() => bash)
    await expect(coreChoose(same.d, { pane_id: 't1', index: 0, label: 'Nope', identity: identity() })).rejects.toMatchObject({ code: 'stale' })
    await expect(coreChoose(same.d, { pane_id: 't1', index: 0, label: 'Yes', identity: 'other' })).rejects.toMatchObject({ code: 'stale' })
    expect(calls.length + same.calls.length).toBe(0)
  })
  it('sends a free answer only once the field has opened', async () => {
    const ask = '  Which fruit?\n ❯ 1. Apple\n   2. Pear\n   3. Type something.\n──────────\n   4. Chat about this\n\nEnter to select · ↑/↓ to navigate · Esc to cancel'
    const c = readCoreScreen(ask, 'claude', 'blocked').choices!
    const free = c.options.findIndex(o => o.free)
    expect(free).toBeGreaterThan(-1)
    let opened = false
    const s = setup(() => (opened ? input : ask))
    s.d.call = async (m, params) => { s.calls.push([m, params]); if (m === 'terminal.keys') opened = true; return {} as never }
    await coreChoose(s.d, { pane_id: 't1', index: free, label: c.options[free]!.label, identity: c.identity, text: 'Kiwi', question: c.question })
    expect(s.calls.map(x => x[0])).toEqual(['terminal.keys', 'terminal.send'])
    expect(s.calls[1]![1]).toEqual({ terminal: 'm/t1', text: 'Kiwi' })
    // The field never opens: the text is not sent.
    const stuck = setup(() => ask)
    await expect(coreChoose(stuck.d, { pane_id: 't1', index: free, label: c.options[free]!.label, identity: c.identity, text: 'Kiwi', question: c.question })).rejects.toMatchObject({ code: 'stale' })
    expect(stuck.calls.map(x => x[0])).toEqual(['terminal.keys'])
  })
  it('rejects an unknown pane and maps core errors', async () => {
    const { d } = setup(() => bash)
    await expect(coreChoose(d, { pane_id: 'zz' })).rejects.toMatchObject({ code: 'bad_pane' })
    d.call = async () => { throw new CoreError('not_found', 'gone') }
    await expect(coreChoose(d, { pane_id: 't1', index: 0, label: 'Yes', identity: identity() })).rejects.toMatchObject({ code: 'stale' })
  })
})
