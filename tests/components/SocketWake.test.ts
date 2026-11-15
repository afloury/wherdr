import { expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createTerminal } from '~/composables/useTerminal'
import { pageVisible, socketWake, terminalRenderer, smoothTouchScrolling } from '~/composables/useHerdr'

vi.mock('@xterm/xterm', () => ({ Terminal: class {
  cols = 80; rows = 24; options = {}; modes = { mouseTrackingMode: 'none' }
  write(_data: unknown, done?: () => void) { done?.() }
  loadAddon() {} open() {} dispose() {} refresh() {} reset() {} attachCustomWheelEventHandler() {}
  attachCustomKeyEventHandler() {} onData() {} onBinary() {}
} }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { proposeDimensions() { return null } } }))
vi.mock('~/utils/terminalMouse', () => ({ bindTerminalMouse: () => ({ dispose() {} }) }))
vi.mock('~/utils/terminalSelection', () => ({ bindTerminalSelection: () => () => {} }))
vi.mock('~/utils/terminalLinks', () => ({ bindTerminalLinks: () => ({ dispose() {} }) }))
vi.mock('~/utils/terminalOsc52', () => ({ OSC52_MAX_BYTES: 1000, bindTerminalOsc52: () => () => {} }))
vi.mock('~/utils/terminalFont', () => ({ TERM_FONT: 'monospace', onFontsLoaded: () => () => {} }))

it.each([false, true])('shares wake probes while preserving touch beta=%s frame accounting', async enabled => {
  smoothTouchScrolling.value = enabled
  const sockets: Socket[] = []
  class Socket {
    readyState = 0
    send = vi.fn()
    close = vi.fn()
    onopen?: () => void
    onmessage?: (e: { data: string }) => void
    onclose?: (() => void) | null
    constructor() { sockets.push(this) }
  }
  vi.stubGlobal('WebSocket', Socket)
  pageVisible.value = true
  terminalRenderer.value = 'html'
  let ctl!: ReturnType<typeof createTerminal>
  const wrapper = mount(defineComponent({
    setup() {
      ctl = createTerminal('w1:p1', { setBanner: vi.fn(), hasBanner: () => false })
      return () => h('div')
    },
  }))
  try {
    await ctl.mount(wrapper.element as HTMLElement)
    ctl.connect(false)
    const ws = sockets[0]!
    const pings = () => ws.send.mock.calls.filter(([data]) => JSON.parse(data).type === 'ping').length
    socketWake.value++
    await nextTick()
    expect(pings()).toBe(0)
    expect(sockets).toHaveLength(1)
    expect(ws.close).not.toHaveBeenCalled()
    ws.readyState = 1
    ws.onopen!()
    socketWake.value++
    await nextTick()
    expect(pings()).toBe(1)
    socketWake.value++
    await nextTick()
    expect(pings()).toBe(1)
    ws.onmessage!({ data: '{"type":"pong"}' })
    await nextTick()
    socketWake.value++
    await nextTick()
    expect(pings()).toBe(2)
    expect(pageVisible.value).toBe(true)
    expect(sockets).toHaveLength(1)
    expect(ws.close).not.toHaveBeenCalled()
    ctl.scroll(2, 10, 20, 0, true)
    const packet = ws.send.mock.calls.map(([data]) => JSON.parse(data)).findLast(m => m.type === 'terminal.scroll')
    expect(packet.source).toBe(enabled ? 'touch' : undefined)
    ws.onmessage!({ data: JSON.stringify({ type: 'terminal.frame', width: 80, height: 24, bytes: '' }) })
    ws.onmessage!({ data: JSON.stringify({ type: 'scroll.ack', epoch: packet.epoch, lines: 2 }) })
    expect(ctl.frameTick.value).toBe(enabled ? 1 : 0)
    expect(ctl.scrollAck.value).toBe(enabled ? 2 : 0)
    const previousVersion = ctl.scrollInputVersion.value
    const staleClose = ws.onclose!
    ctl.connect(false)
    expect(ctl.scrollInputVersion.value).toBe(previousVersion + (enabled ? 1 : 0))
    const replacement = sockets[1]!
    replacement.readyState = 1
    replacement.onopen!()
    ctl.scroll(1, 10, 20, 0, true)
    const nextPacket = replacement.send.mock.calls.map(([data]) => JSON.parse(data)).findLast(m => m.type === 'terminal.scroll')
    staleClose()
    expect(ctl.scrollInputVersion.value).toBe(previousVersion + (enabled ? 1 : 0))
    replacement.onmessage!({ data: JSON.stringify({ type: 'scroll.ack', epoch: nextPacket.epoch, lines: 1 }) })
    expect(ctl.scrollAck.value).toBe(enabled ? 3 : 0)
  } finally {
    ctl.dispose()
    smoothTouchScrolling.value = false
    wrapper.unmount()
    vi.unstubAllGlobals()
  }
})

it.each([
  { name: 'relay reset and control only', paint: null },
  { name: 'normal core output', paint: 'hello from core' },
  // Core always sends an attach snapshot, even without new program output.
  { name: 'idle shell snapshot', paint: '\x18\x1b[H\x1b[2J\x1b[?9001l' },
  { name: 'cleared screen snapshot', paint: '\x1b[2J\x1b[H' },
])('waits for core paint: $name', async ({ paint }) => {
  vi.useFakeTimers()
  const sockets: Socket[] = []
  class Socket {
    readyState = 0
    send = vi.fn()
    close = vi.fn(() => { this.readyState = 3; this.onclose?.() })
    onopen?: () => void
    onmessage?: (e: { data: string }) => void
    onclose?: (() => void) | null
    constructor() { sockets.push(this) }
  }
  vi.stubGlobal('WebSocket', Socket)
  pageVisible.value = true
  terminalRenderer.value = 'html'
  const setBanner = vi.fn()
  let ctl!: ReturnType<typeof createTerminal>
  const wrapper = mount(defineComponent({
    setup() {
      ctl = createTerminal('w1:p1', { setBanner, hasBanner: () => false })
      return () => h('div')
    },
  }))
  try {
    await ctl.mount(wrapper.element as HTMLElement)
    ctl.connect(false)
    const ws = sockets[0]!
    const receive = (packet: object) => ws.onmessage!({ data: JSON.stringify(packet) })
    ws.readyState = 1
    ws.onopen!()
    // events.subscribe precedes attach: another viewer's size event can send
    // an empty frame and control state before capabilities announce core.
    receive({ type: 'terminal.frame', width: 80, height: 24, bytes: '' })
    receive({ type: 'terminal.control', on: false })
    const loadingBeforeCapabilities = ctl.loading.value
    // The relay sends these before core's attach DATA arrives. Neither proves
    // that core painted, and pongs/resize frames must not reset the deadline.
    receive({ type: 'web.capabilities', mouse: false, core: true })
    receive({ type: 'terminal.frame', full: true, width: 80, height: 24, bytes: '' })
    receive({ type: 'terminal.control', on: true })
    const loadingBeforePaint = ctl.loading.value
    if (paint !== null) {
      const bytes = new TextEncoder().encode(paint)
      receive({ type: 'terminal.frame', width: 80, height: 24, bytes: btoa(paint), credit: bytes.length })
      expect(ctl.loading.value).toBe(false)
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'credit', bytes: bytes.length }))
    }
    await vi.advanceTimersByTimeAsync(6000)
    receive({ type: 'terminal.frame', width: 80, height: 24, bytes: '' })
    receive({ type: 'terminal.control', on: false })
    receive({ type: 'pong' })
    await vi.advanceTimersByTimeAsync(5999)
    expect(ws.close).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(ws.close).toHaveBeenCalledTimes(paint === null ? 1 : 0)
    if (paint === null) {
      expect(loadingBeforeCapabilities).toBe(true)
      expect(loadingBeforePaint).toBe(true)
      await vi.advanceTimersByTimeAsync(399)
      expect(sockets).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(sockets).toHaveLength(2)
      expect(ctl.loading.value).toBe(true)
      // After four silent attaches, the user gets a plain Retry banner.
      for (let attempt = 1; attempt < 4; attempt++) {
        const retry = sockets[attempt]!
        retry.readyState = 1
        retry.onopen!()
        await vi.advanceTimersByTimeAsync(12000)
        if (attempt < 3) await vi.advanceTimersByTimeAsync(400 * 2 ** attempt)
      }
      expect(sockets).toHaveLength(4)
      expect(setBanner).toHaveBeenLastCalledWith(expect.objectContaining({
        text: 'Terminal unavailable: the machine sent nothing in time', btn: 'Retry',
      }))
    } else {
      // This is an initial-paint deadline, not a timer for subsequent output.
      await vi.advanceTimersByTimeAsync(24000)
      expect(ws.close).not.toHaveBeenCalled()
      expect(sockets).toHaveLength(1)
      expect(ctl.loading.value).toBe(false)
    }
  } finally {
    ctl.dispose()
    wrapper.unmount()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  }
})
