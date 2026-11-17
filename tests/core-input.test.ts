import { describe, expect, it } from 'vitest'
import { CoreError } from '../server/utils/core'
import { coreInput, coreInterrupt, coreKeepGet, coreKeepSet, coreKill, coreSend, holdEnter, resumeSubmitting, type CoreInputDeps } from '../server/utils/coreInput'
import { fieldHolds, isBareBang } from '../shared/queuedMatch'
import { takingTurns } from '../server/utils/terminalTurns'
import { HerdrError } from '../server/utils/herdr'
import type { Pane } from '../shared/types'

const pane = (id: string, extra: Partial<Pane> = {}) => ({ id, workspace: 'w1', coreAddress: `m/${id}`, agent: 'claude', ...extra }) as Pane
function deps(reply: (method: string, params: any) => unknown = () => ({})) {
  const calls: [string, any, number][] = []
  let refreshed = 0
  const panes = [pane('t1'), pane('t2'), pane('t3', { workspace: 'w2' })]
  const d: CoreInputDeps = {
    call: async (method, params, timeout) => {
      calls.push([method, params, timeout])
      const r = reply(method, params)
      if (r instanceof Error) throw r
      return r as never
    },
    pane: id => panes.find(p => p.id === id),
    panes: () => panes,
    refresh: () => { refreshed++ },
    turnSettleMs: 0,
  }
  return { d, calls, refreshed: () => refreshed }
}

describe('core input routes', () => {
  it('sends a message once with terminal.send on the full address', async () => {
    const t = deps(() => ({ started: true, turn: 3 }))
    expect(await coreSend(t.d, { pane_id: 't1', text: 'fix the bug' })).toEqual({ ok: true, started: true })
    expect(t.calls).toEqual([['terminal.send', { terminal: 'm/t1', text: 'fix the bug' }, 30000]])
    expect(t.refreshed()).toBe(1)
    await expect(coreSend(t.d, { pane_id: 't1', text: '  ' })).rejects.toMatchObject({ code: 'empty' })
    await expect(coreSend(t.d, { pane_id: 'nope', text: 'x' })).rejects.toMatchObject({ code: 'bad_pane' })
  })

  it('presses Enter once when a multi-line send was left in the input (no turn started)', async () => {
    const t = deps((m) => m === 'terminal.send' ? { started: false } : m === 'terminal.get' ? { status: 'idle' } : {})
    t.d.settleMs = 1
    expect(await coreSend(t.d, { pane_id: 't1', text: 'see\n@/f/a.txt' })).toEqual({ ok: true, started: null })
    expect(t.calls.map(c => c[0])).toEqual(['terminal.send', 'terminal.get', 'terminal.keys'])
    expect(t.calls[2]![1]).toEqual({ terminal: 'm/t1', keys: ['enter'] })
    // Already working, or a one-line message: no extra Enter.
    const w = deps((m) => m === 'terminal.send' ? { started: false } : { status: { state: 'blocked' } })
    w.d.settleMs = 1
    await coreSend(w.d, { pane_id: 't1', text: 'a\nb' })
    await coreSend(w.d, { pane_id: 't1', text: 'one line' })
    expect(w.calls.filter(c => c[0] === 'terminal.keys')).toHaveLength(0)
  })

  it('Claude\'s input already holds text: nothing typed, the send is refused', async () => {
    const t = deps(() => ({ started: true }))
    t.d.field = async () => '[Image #120] what is wrong here?'
    await expect(coreSend(t.d, { pane_id: 't1', text: 'and this?' })).rejects.toMatchObject({ code: 'input_busy' })
    expect(t.calls).toEqual([])
  })

  it('a send while a wake is being typed waits for it, then goes once the field is empty', async () => {
    let release!: () => void
    const wake = new Promise<void>(r => { release = r })
    const t = deps(() => ({ started: true }))
    t.d.settleMs = 1
    const engine = takingTurns(async (m, params) => { t.calls.push([m, params, 0]); await wake; return {} as never }, 0)
    const delivering = engine('terminal.send', { terminal: 'm/t1', text: 'Autopilot wake' }, 30000)
    // Claude still empties its field for a moment after the wake.
    let looks = 0
    t.d.field = async () => (looks++ < 2 ? 'Autopilot wake' : null)
    const sending = coreSend(t.d, { pane_id: 't1', text: 'look\n/srv/core/files/t1/2026-01-01T10-00-00-000Z-a1b2c3.png' })
    await new Promise(r => setTimeout(r, 5))
    expect(t.calls.map(c => c[1].text)).toEqual(['Autopilot wake'])
    release()
    await delivering
    expect(await sending).toEqual({ ok: true, started: true })
    expect(t.calls.map(c => c[1].text)).toEqual(['Autopilot wake', 'look\n/srv/core/files/t1/2026-01-01T10-00-00-000Z-a1b2c3.png\n\\'])
  })

  it('a send right after a wake was delivered: typed once the field is empty, once, nothing left in it', async () => {
    const t = deps(() => ({ started: true }))
    t.d.settleMs = 1
    const engine = takingTurns(async () => ({}) as never, 40)
    await engine('terminal.send', { terminal: 'm/t9', text: 'Autopilot wake' }, 30000)
    ;(t.d.pane('t1') as Pane).coreAddress = 'm/t9'
    const done = Date.now()
    let field: string | null = 'Autopilot wake'
    t.d.field = async () => field
    setTimeout(() => { field = null }, 20)
    const photos = '/srv/core/files/t1/2026-01-01T10-00-00-000Z-a1b2c3.png\n/srv/core/files/t1/2026-01-01T10-00-01-000Z-d4e5f6.png\nwhat now?'
    const sending = coreSend(t.d, { pane_id: 't1', text: photos })
    await sending
    expect(Date.now() - done).toBeGreaterThanOrEqual(35)
    expect(t.calls).toEqual([['terminal.send', { terminal: 'm/t9', text: `${photos}\n\\` }, 30000]])
    expect(await t.d.field!(t.d.pane('t1')!)).toBeNull()
  })

  it('our photo message left in Claude\'s input (also during a turn): Enter once; not for other text', async () => {
    const msg = '/home/user/.cache/herdr-web/uploads/a.jpg\nwhat is wrong here?'
    const long = `${msg}\n${Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n')}`
    for (const [text, after, enters] of [[msg, '[Image #120] what is wrong here?', 1], [msg, '', 0], [msg, '[Image #120] what is wrong here? more', 0],
      // A long paste, shown as its stand-in: still ours alone.
      [long, '[Image #120] what is wrong here? [Pasted text #1 +29 lines]', 1], [long.split('\n').slice(1).join('\n'), '[Pasted text #1 +29 lines]', 1]] as const) {
      let reads = 0
      let entered = false
      const t = deps((m) => { if (m === 'terminal.keys') entered = true; return m === 'terminal.send' ? { started: false } : {} })
      t.d.settleMs = 1
      t.d.field = async () => (reads++ && !entered ? after : null)
      await coreSend(t.d, { pane_id: 't1', text })
      expect(t.calls.filter(c => c[0] === 'terminal.keys')).toHaveLength(enters)
    }
  })

  it('text + photo: sent with a lone "\\" (core\'s Enter is a new line), submitted once Claude shows the tag, drawn first', async () => {
    const msg = 'look\n/srv/core/files/t1/2026-01-01T10-00-00-000Z-a1b2c3.png'
    expect(holdEnter('no photo')).toBe('no photo')
    // Claude reads the photo (its path still there), then draws "[Image #4]" before
    // the text; the "\" stays while no Enter came after it.
    const screens = [null, `${msg}\n\\`, '[Image #4]look\n\\']
    let looks = 0
    let enters = 0
    const t = deps((m) => { if (m === 'terminal.keys') enters++; return m === 'terminal.send' ? { started: false } : {} })
    t.d.settleMs = 1
    t.d.field = async () => (enters ? null : screens[Math.min(looks++, 2)]!)
    expect(await coreSend(t.d, { pane_id: 't1', text: msg })).toEqual({ ok: true, started: null })
    expect(t.calls[0]![1].text).toBe(`${msg}\n\\`)
    expect(enters).toBe(1)
    expect(fieldHolds('[Image #4] look', msg, true)).toBe(true)
  })

  it('a photo Claude leaves as its path: when the wait ends, the "\\" is taken out and Enter pressed; one log line, no text', async () => {
    const msg = 'look at this\n/srv/core/files/t1/2026-01-01T10-00-00-000Z-a1b2c3.png'
    const keys: string[] = []
    let field: string | null = `${msg}\n\\`
    const t = deps((m, params) => {
      if (m === 'terminal.keys') {
        keys.push(...params.keys)
        if (params.keys[0] === 'backspace') field = field!.replace(/\n?\\$/, '')
        if (params.keys[0] === 'enter') field = null
      }
      return m === 'terminal.send' ? { started: false } : {}
    })
    t.d.settleMs = 1
    let looks = 0
    t.d.field = async () => (looks++ ? field : null)
    const logs: string[] = []
    const warn = console.warn
    console.warn = (l: string) => { logs.push(l) }
    try {
      expect(await coreSend(t.d, { pane_id: 't1', text: msg })).toEqual({ ok: true, started: null })
    } finally { console.warn = warn }
    expect(keys).toEqual(['backspace', 'enter'])
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatch(/a photo stayed a path, sent as it is after \d+ ms: field held \d+ chars, 0 images; expected \d+ chars, 1 images, 2 lines$/)
    expect(logs[0]).not.toMatch(/look|srv/)
  })

  it('a photo message: Enter only once Claude shows its placeholder, again while it stays (bounded)', async () => {
    const msg = '/home/user/.cache/herdr-web/uploads/a.jpg\nwhat is wrong here?'
    const path = '/home/user/.cache/herdr-web/uploads/a.jpg what is wrong here?'
    const tag = '[Image #3] what is wrong here?'
    // Claude still reading the photo: its path is in the field, then "[Image #3]";
    // the first two Enters are dropped (Claude switching turns), the third takes it.
    const run = async (send: object, screen: (look: number, enters: number) => string | null) => {
      const seen: (string | null)[] = []
      let looks = 0
      let enters = 0
      let last: string | null = null
      const t = deps((m) => { if (m === 'terminal.keys') { seen.push(last); enters++ } return m === 'terminal.send' ? send : {} })
      t.d.settleMs = 1
      t.d.field = async () => (last = screen(looks++, enters))
      return { r: await coreSend(t.d, { pane_id: 't1', text: msg }), seen, looks: () => looks }
    }
    const dropped = await run({ started: false }, (n, e) => (n === 0 ? null : n < 3 ? path : e < 3 ? tag : null))
    expect(dropped.r).toEqual({ ok: true, started: null })
    expect(dropped.seen).toEqual([tag, tag, tag])
    // Never taken: at most ten Enters, then the field's own "Not sent".
    expect((await run({ started: false }, n => (n ? tag : null))).seen).toHaveLength(10)
    // A large photo whose placeholder shows after about 20 s (50 looks): still submitted, once.
    expect((await run({ started: false }, (n, e) => (n === 0 ? null : n < 50 ? path : e ? null : tag))).seen).toEqual([tag])
  })

  it('sent while Claude works: core says started, yet its Enter came before the placeholder; it is submitted once', async () => {
    const msg = '/srv/core/files/t1/2026-01-01T10-00-00-000Z-a1b2c3.png\nsecond picture, describe it'
    let looks = 0
    let enters = 0
    // herdr-core 0.1.16 answers `started: true, status: "working"` for a send during a turn.
    const t = deps((m) => { if (m === 'terminal.keys') enters++; return m === 'terminal.send' ? { started: true, status: 'working' } : {} })
    t.d.settleMs = 1
    t.d.field = async () => (looks++ === 0 ? null : looks < 4 ? msg.replace('\n', ' ') : enters ? null : '[Image #2]second picture, describe it')
    expect(await coreSend(t.d, { pane_id: 't1', text: msg })).toEqual({ ok: true, started: null })
    expect(enters).toBe(1)
    // Taken at once from an idle agent: one look at the empty field, no Enter.
    const idle = deps(m => (m === 'terminal.send' ? { started: true, status: 'idle' } : {}))
    idle.d.settleMs = 1
    let read = 0
    idle.d.field = async () => { read++; return null }
    expect(await coreSend(idle.d, { pane_id: 't1', text: msg })).toEqual({ ok: true, started: true })
    expect(read).toBe(2)
    expect(idle.calls.map(c => c[0])).toEqual(['terminal.send'])
  })

  it('idle agent: core says started, yet the message stays in the input and Enter is ignored twice; it is submitted once', async () => {
    const msg = '/srv/core/files/t1/2026-01-01T10-00-00-000Z-a1b2c3.jpg\nwhat is on this screenshot?'
    let looks = 0
    let enters = 0
    const t = deps((m) => { if (m === 'terminal.keys') enters++; return m === 'terminal.send' ? { started: true, status: 'idle' } : {} })
    t.d.settleMs = 1
    // A failed read in between is not an empty field.
    t.d.field = async () => { looks++; if (looks === 2) throw new Error('paint'); return looks === 1 || enters >= 3 ? null : '[Image #8] what is on this screenshot?' }
    expect(await coreSend(t.d, { pane_id: 't1', text: msg })).toEqual({ ok: true, started: null })
    expect(enters).toBe(3)
  })

  // WHR-419, reproduced on Claude Code 2.1.319: three large photos and a
  // multi-line text to an idle Claude. Its field stays empty under "Pasting…"
  // for seconds (the photos are read), then shows them renumbered with the
  // text collapsed; the send's own Enter is lost.
  const three = ['/srv/core/files/t1/2026-01-01T10-00-00-000Z-a1b2c1.jpg', '/srv/core/files/t1/2026-01-01T10-00-00-000Z-a1b2c2.jpg', '/srv/core/files/t1/2026-01-01T10-00-00-000Z-a1b2c3.jpg',
    'Three screenshots of the settings page.', '', 'The header overlaps the menu.', 'The list loses its scroll.', '', 'Thanks!'].join('\n')
  const collapsed = '[Image #9] [Image #10] [Image #11][Pasted text #12 +6 lines]'

  it('three photos and a multi-line text: an empty field under "Pasting…" is not taken; submitted once it shows', async () => {
    let looks = 0
    let enters = 0
    const noted: string[] = []
    let notedAtSend = 0
    const t = deps((m) => { if (m === 'terminal.keys') enters++; if (m === 'terminal.send') notedAtSend = noted.length; return m === 'terminal.send' ? { started: false, status: 'idle' } : {} })
    t.d.settleMs = 1
    t.d.submitting = (_terminal, text) => { noted.push(text); return () => { noted.splice(noted.indexOf(text), 1) } }
    t.d.field = async () => {
      looks++
      if (looks === 1 || enters) return null
      if (looks < 20) throw new HerdrError('pasting', 'Claude is still pasting')
      return collapsed
    }
    expect(await coreSend(t.d, { pane_id: 't1', text: three })).toEqual({ ok: true, started: null })
    expect(notedAtSend).toBe(1)
    expect(enters).toBe(1)
    expect(noted).toEqual([])
  })

  it('a restart mid-send: resumed, Enter only while the field holds that message; a log line with sizes, never text', async () => {
    let enters = 0
    const t = deps((m) => { if (m === 'terminal.keys') enters++; return {} })
    t.d.settleMs = 1
    t.d.field = async () => (enters ? null : collapsed)
    await resumeSubmitting(t.d, [{ id: 'a', terminal: 'm/t1', text: three, at: Date.now() }])
    expect(enters).toBe(1)
    // Already taken before the restart: nothing pressed. Other text there: nothing pressed, and why is logged.
    const logs: string[] = []
    const warn = console.warn
    console.warn = (l: string) => { logs.push(l) }
    try {
      for (const now of [null, '[Image #9] something else']) {
        const o = deps()
        o.d.settleMs = 1
        o.d.field = async () => now
        await resumeSubmitting(o.d, [{ id: 'b', terminal: 'm/t1', text: three, at: Date.now() }])
        expect(o.calls.filter(c => c[0] === 'terminal.keys')).toEqual([])
      }
    } finally { console.warn = warn }
    expect(logs.at(-1)).toMatch(/never held the message alone: field held 20 chars, 1 images; expected 109 chars, 3 images, 9 lines$/)
    expect(logs.join('\n')).not.toMatch(/settings|something/)
  })

  it('sends a multi-line "!" command as it is, in one terminal.send', async () => {
    // Claude Code 2.1.318 runs the whole text in bash mode, lines included.
    const cmd = '! cd /srv/app\nnpm run build\n. ./env.sh dev\nls dist/'
    const t = deps(() => ({ started: true }))
    expect(await coreSend(t.d, { pane_id: 't1', text: cmd })).toEqual({ ok: true, started: true })
    expect(t.calls).toEqual([['terminal.send', { terminal: 'm/t1', text: cmd }, 30000]])
  })

  it('refuses a lone "!": it would leave Claude in bash mode for the next message', async () => {
    for (const text of ['!', ' ! ', '!\n']) {
      const t = deps()
      await expect(coreSend(t.d, { pane_id: 't1', text })).rejects.toMatchObject({ code: 'empty' })
      expect(t.calls).toHaveLength(0)
    }
    expect(isBareBang('! ls')).toBe(false)
    expect(isBareBang('!!')).toBe(false)
  })

  it('maps core errors to stable messages and never retries', async () => {
    for (const [kind, code] of [['blocked', 'blocked'], ['timeout', 'timeout'], ['not_found', 'stale'], ['unavailable', 'unreachable'], ['unreachable', 'unreachable']]) {
      const t = deps(() => new CoreError(kind!, 'x'))
      await expect(coreSend(t.d, { pane_id: 't1', text: 'hi' })).rejects.toMatchObject({ code })
      expect(t.calls).toHaveLength(1)
    }
  })

  it('routes text + Enter as a message and named keys through terminal.keys', async () => {
    const t = deps()
    await coreInput(t.d, { pane_id: 't1', text: 'ls', keys: ['enter'] })
    await coreInput(t.d, { pane_id: 't1', keys: ['esc', 'shift+tab'] })
    expect(t.calls.map(c => [c[0], c[1]])).toEqual([
      ['terminal.send', { terminal: 'm/t1', text: 'ls' }],
      ['terminal.keys', { terminal: 'm/t1', keys: ['esc', 'shift+tab'] }],
    ])
    await expect(coreInput(t.d, { pane_id: 't1', text: 'raw' })).rejects.toMatchObject({ code: 'unsupported' })
    await expect(coreInput(t.d, { pane_id: 't1', keys: ['esc;x'] })).rejects.toMatchObject({ code: 'bad_keys' })
  })

  it('passes the key bar navigation keys to core by name', async () => {
    const t = deps()
    for (const k of ['home', 'end', 'pageup', 'pagedown', 'insert', 'delete', 'ctrl+shift+end']) await coreInput(t.d, { pane_id: 't1', keys: [k] })
    expect(t.calls.map(c => (c[1] as { keys: string[] }).keys[0])).toEqual(['home', 'end', 'pageup', 'pagedown', 'insert', 'delete', 'ctrl+shift+end'])
  })

  it('reports what interrupt observed without escalating', async () => {
    for (const [outcome, stopped] of [['stopped', true], ['exited', true], ['still_working', false], ['unknown', false]] as const) {
      const t = deps(() => ({ outcome, key: 'esc' }))
      expect(await coreInterrupt(t.d, { pane_id: 't1' })).toMatchObject({ ok: true, outcome, stopped })
      expect(t.calls.map(c => c[0])).toEqual(['terminal.interrupt'])
    }
  })

  it('kills one terminal, or each terminal of its group', async () => {
    const t = deps()
    await coreKill(t.d, { pane_id: 't1' })
    await coreKill(t.d, { pane_id: 't1', close_group: true })
    expect(t.calls.map(c => c[1].terminal)).toEqual(['m/t1', 'm/t1', 'm/t2'])
  })
})

describe('keep after restart', () => {
  it('reads the flag with terminal.get and sets it with terminal.keep on the full address', async () => {
    const t = deps(m => m === 'terminal.get' ? { keep: true } : {})
    expect(await coreKeepGet(t.d, 't1')).toEqual({ keep: true })
    expect(await coreKeepSet(t.d, { pane_id: 't1', keep: false })).toEqual({ keep: false })
    expect(t.calls.map(c => [c[0], c[1]])).toEqual([['terminal.get', { terminal: 'm/t1' }], ['terminal.keep', { terminal: 'm/t1', keep: false }]])
  })
  it('refuses a missing pane and a non-boolean value', async () => {
    const t = deps()
    await expect(coreKeepSet(t.d, { pane_id: 'nope', keep: true })).rejects.toMatchObject({ code: 'bad_pane' })
    await expect(coreKeepSet(t.d, { pane_id: 't1', keep: 'yes' })).rejects.toMatchObject({ code: 'bad_keep' })
  })
})

describe('core interrupt: prompt put back by Claude', () => {
  it('returns the text taken back after a Stop from the conversation', async () => {
    const t = deps(() => ({ outcome: 'stopped' }))
    const taken: string[] = []
    t.d.takeBack = async (p) => { taken.push(p.id); return { text: 'queued message', lost: 0 } }
    expect(await coreInterrupt(t.d, { pane_id: 't1', restore: true })).toMatchObject({ stopped: true, restored: 'queued message' })
    expect(taken).toEqual(['t1'])
  })
  it('does not take anything back without restore, when not stopped, or for another agent', async () => {
    const t = deps(() => ({ outcome: 'timeout' }))
    let n = 0
    t.d.takeBack = async () => { n++; return { text: 'x', lost: 0 } }
    expect(await coreInterrupt(t.d, { pane_id: 't1', restore: true })).not.toHaveProperty('restored')
    const u = deps(() => ({ outcome: 'stopped' }))
    u.d.takeBack = async () => { n++; return { text: 'x', lost: 0 } }
    await coreInterrupt(u.d, { pane_id: 't1' })
    ;(u.d.pane('t2') as Pane).agent = 'codex'
    await coreInterrupt(u.d, { pane_id: 't2', restore: true })
    expect(n).toBe(0)
  })
})
