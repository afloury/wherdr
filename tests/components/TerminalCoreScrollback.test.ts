import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createTerminal } from '~/composables/useTerminal'
import { desk, terminalRenderer } from '~/composables/useHerdr'

// A core program (agy) answers SIGWINCH with ESC[2J ESC[3J ESC[H: clear the
// screen AND the scrollback. The screen clear is its own business; the saved
// lines are the history this viewer already holds, so xterm keeps them.
const h1 = vi.hoisted(() => ({
  terms: [] as FakeTerm[],
  fit: { cols: 50, rows: 35 } as { cols: number, rows: number } | undefined,
}))

class FakeTerm {
  cols = 80
  rows = 24
  options: Record<string, unknown> = { fontFamily: 'monospace', fontSize: 13, theme: {} }
  textarea = document.createElement('textarea')
  element = document.createElement('div')
  screen = document.createElement('div')
  modes = { mouseTrackingMode: 'none' }
  buffer = { active: { viewportY: 0, baseY: 0, length: 0, cursorY: 0 } }
  csi: { spec: { final?: string, prefix?: string }, fn: (params: unknown[]) => boolean }[] = []
  written: unknown[] = []
  constructor(init?: Record<string, unknown>) {
    if (init) Object.assign(this.options, init)
    h1.terms.push(this)
    this.screen.className = 'xterm-screen'
    Object.defineProperty(this.screen, 'offsetHeight', { configurable: true, get: () => this.rows * 16 })
    this.element.append(this.screen, this.textarea)
  }
  open(host: HTMLElement) { host.append(this.element) }
  resize(cols: number, rows: number) { this.cols = cols; this.rows = rows }
  focus() { this.textarea.focus() }
  // What xterm's parser does with the bytes a frame carries: ED 2 clears the
  // screen, ED 3 asks the registered handlers first (the view swallows it on
  // a core stream; otherwise scrollback collapses), and CUP moves cursor home.
  write(d: unknown, cb?: () => void) {
    this.written.push(d)
    const s = d instanceof Uint8Array ? new TextDecoder('latin1').decode(d) : String(d)
    if (s.includes('\x1b[3J') && !this.eraseSavedLines()) {
      this.buffer.active.baseY = 0
      this.buffer.active.viewportY = 0
      this.buffer.active.length = this.rows
    }
    if (s.includes('\x1b[2J')) {
      this.csi.filter(h => h.spec.final === 'J' && !h.spec.prefix).some(h => h.fn([2]) === true)
      this.buffer.active.cursorY = 0
    }
    if (s.includes('\x1b[H')) this.buffer.active.cursorY = 0
    cb?.()
  }
  loadAddon() {} dispose() {} refresh() {} clearTextureAtlas() {} reset() {}
  parser = {
    registerCsiHandler: (spec: { final?: string, prefix?: string }, fn: (params: unknown[]) => boolean) => {
      this.csi.push({ spec, fn })
      return { dispose() {} }
    },
    registerEscHandler: () => ({ dispose() {} }),
  }
  // What xterm does with a registered CSI handler: the first one that claims
  // the sequence (returns true) swallows it.
  eraseSavedLines() {
    return this.csi.some(h => h.spec.final === 'J' && !h.spec.prefix && h.fn([3]) === true)
  }
  registerMarker(offset = 0) {
    const b = this.buffer.active
    return { line: b.baseY + b.cursorY + offset, isDisposed: false, dispose() { this.isDisposed = true }, onDispose() { return { dispose() {} } } }
  }
  attachCustomWheelEventHandler() {} attachCustomKeyEventHandler() {}
  onData() {} onBinary() {} onScroll() {}
  scrollLines(n: number) {
    this.buffer.active.viewportY = Math.max(0, Math.min(this.buffer.active.baseY, this.buffer.active.viewportY + n))
  }
  scrollToBottom() { this.buffer.active.viewportY = this.buffer.active.baseY }
  scrollToLine(y: number) { this.buffer.active.viewportY = y }
}

vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerm }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class {} }))
vi.mock('~/utils/terminalSize', async importOriginal => ({ ...(await importOriginal() as object), proposeTerminalSize: () => h1.fit }))
vi.mock('~/utils/terminalMouse', () => ({ bindTerminalMouse: () => ({ dispose() {} }) }))
vi.mock('~/utils/terminalSelection', () => ({ bindTerminalSelection: () => () => {} }))
vi.mock('~/utils/terminalLinks', () => ({ bindTerminalLinks: () => ({ dispose() {} }) }))
vi.mock('~/utils/terminalOsc52', () => ({ OSC52_MAX_BYTES: 1000, bindTerminalOsc52: () => () => {} }))
vi.mock('~/utils/terminalFont', async importOriginal => ({ ...(await importOriginal() as object), TERM_FONT: 'monospace', onFontsLoaded: () => () => {} }))

class FakeSocket {
  static all: FakeSocket[] = []
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  sent: Record<string, unknown>[] = []
  constructor(public url: string) { FakeSocket.all.push(this) }
  send(s: string) { this.sent.push(JSON.parse(s)) }
  close() { this.readyState = 3; this.onclose?.() }
  open() { this.readyState = 1; this.onopen?.() }
  receive(m: unknown) { this.onmessage?.({ data: JSON.stringify(m) }) }
}

async function open() {
  let ctl!: ReturnType<typeof createTerminal>
  const wrapper = mount(defineComponent({
    setup() {
      ctl = createTerminal('w1:p1', { setBanner: () => {}, hasBanner: () => false })
      return () => h('div')
    },
  }), { attachTo: document.body })
  terminalRenderer.value = 'html'
  const parent = document.createElement('div')
  const el = document.createElement('div')
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 640 })
  parent.append(el)
  document.body.append(parent)
  expect(await ctl.mount(el)).toBe(true)
  await nextTick()
  ctl.fitNow(false)
  ctl.connect(false)
  const ws = FakeSocket.all.at(-1)!
  ws.open()
  return { ctl, ws, wrapper, term: h1.terms[0]! }
}

beforeEach(() => {
  h1.terms.length = 0
  h1.fit = { cols: 50, rows: 35 }
  FakeSocket.all.length = 0
  desk.value = false
  vi.stubGlobal('WebSocket', FakeSocket)
})
afterEach(() => { vi.unstubAllGlobals(); desk.value = false })

it('a core stream keeps its scrollback when the program erases the saved lines', async () => {
  const { ctl, ws, wrapper, term } = await open()
  try {
    ws.receive({ type: 'web.capabilities', core: true })
    ws.receive({ type: 'terminal.frame', full: true, width: 151, height: 41, bytes: '' })
    term.buffer.active.baseY = 80
    term.buffer.active.length = 121
    term.buffer.active.viewportY = 80
    ws.receive({ type: 'terminal.frame', bytes: btoa('\x1b[2J\x1b[3J\x1b[Hfooter'), credit: 7, width: 151, height: 41 })
    expect(term.eraseSavedLines()).toBe(true)
    expect(term.buffer.active.baseY).toBe(80)
  } finally { ctl.dispose(); wrapper.unmount() }
})

it('a non-core stream still clears its saved lines', async () => {
  const { ctl, ws, wrapper, term } = await open()
  try {
    ws.receive({ type: 'web.capabilities', core: false })
    term.buffer.active.baseY = 80
    term.buffer.active.length = 104
    term.buffer.active.viewportY = 80
    ws.receive({ type: 'terminal.frame', bytes: btoa('\x1b[2J\x1b[3J\x1b[H') })
    expect(term.eraseSavedLines()).toBe(false)
    expect(term.buffer.active.baseY).toBe(0)
  } finally { ctl.dispose(); wrapper.unmount() }
})

it('a watching phone keeps scrollback and returns to the cursor row when the program clears the screen', async () => {
  const { ctl, ws, wrapper, term } = await open()
  try {
    ws.receive({ type: 'web.capabilities', core: true })
    ws.receive({ type: 'terminal.control', on: false })
    ws.receive({ type: 'terminal.frame', width: 200, height: 120, bytes: '' })
    const buf = term.buffer.active
    // A 200×120 pane holding 324 lines: 204 rows of history, then the screen.
    buf.baseY = 204
    buf.length = 324
    buf.cursorY = 119
    buf.viewportY = 204
    ws.receive({ type: 'terminal.frame', width: 200, height: 120, bytes: btoa('x') })
    // At the tail, the window is lifted onto the cursor's row.
    const lift = () => Number(/translateY\(-([\d.]+)px\)/.exec(term.screen.style.transform)?.[1] ?? 0)
    expect(lift()).toBeGreaterThan(0)
    // The reader scrolls back ten rows in xterm's buffer while still watching
    // the lifted screen.
    ctl.scroll(10)
    expect(buf.viewportY).toBe(194)
    expect(lift()).toBeGreaterThan(0)
    // The shell runs clear: ESC[H ESC[2J ESC[3J, the saved lines swallowed.
    // The screen is blank again, the prompt on its first row.
    ws.receive({ type: 'terminal.frame', width: 200, height: 120, bytes: btoa('\x1b[H\x1b[2J\x1b[3Jscratch$ ') })
    // Scrollback stays, and xterm's viewport returns to the cursor's row
    // instead of remaining parked in older scrollback below the cleared screen.
    expect(buf.baseY).toBe(204)
    expect(term.screen.style.transform).toBe('')
    expect(buf.viewportY).toBe(buf.baseY)
  } finally { ctl.dispose(); wrapper.unmount() }
})

it('a viewer in control keeps a scrolled-back viewport across a screen erase', async () => {
  const { ctl, ws, wrapper, term } = await open()
  try {
    ws.receive({ type: 'web.capabilities', core: true })
    ws.receive({ type: 'terminal.control', on: true })
    ws.receive({ type: 'terminal.frame', width: 50, height: 35, bytes: '' })
    const buf = term.buffer.active
    buf.baseY = 204
    buf.length = 239
    buf.viewportY = 100
    ws.receive({ type: 'terminal.frame', width: 50, height: 35, bytes: btoa('\x1b[H\x1b[2J\x1b[3J') })
    expect(buf.baseY).toBe(204)
    expect(buf.viewportY).toBe(100)
    // Losing control later must not treat that earlier ED 2 as a fresh clear.
    ws.receive({ type: 'terminal.control', on: false })
    expect(buf.viewportY).toBe(100)
  } finally { ctl.dispose(); wrapper.unmount() }
})
