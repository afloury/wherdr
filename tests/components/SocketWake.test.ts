import { expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createTerminal } from '~/composables/useTerminal'
import { pageVisible, socketWake, terminalRenderer } from '~/composables/useHerdr'

vi.mock('@xterm/xterm', () => ({ Terminal: class {
  cols = 80; rows = 24; options = {}; modes = { mouseTrackingMode: 'none' }
  loadAddon() {} open() {} dispose() {} refresh() {} attachCustomWheelEventHandler() {}
  attachCustomKeyEventHandler() {} onData() {} onBinary() {}
} }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { proposeDimensions() { return null } } }))
vi.mock('~/utils/terminalMouse', () => ({ bindTerminalMouse: () => ({ dispose() {} }) }))
vi.mock('~/utils/terminalSelection', () => ({ bindTerminalSelection: () => () => {} }))
vi.mock('~/utils/terminalLinks', () => ({ bindTerminalLinks: () => ({ dispose() {} }) }))
vi.mock('~/utils/terminalOsc52', () => ({ OSC52_MAX_BYTES: 1000, bindTerminalOsc52: () => () => {} }))
vi.mock('~/utils/terminalFont', () => ({ TERM_FONT: 'monospace', onFontsLoaded: () => () => {} }))

it('probes an already visible terminal on each wake, sharing overlapping probes', async () => {
  const sockets: Socket[] = []
  class Socket {
    readyState = 0
    send = vi.fn()
    close = vi.fn()
    onopen?: () => void
    onmessage?: (e: { data: string }) => void
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
    ctl.mount(wrapper.element as HTMLElement)
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
  } finally {
    ctl.dispose()
    wrapper.unmount()
    vi.unstubAllGlobals()
  }
})
