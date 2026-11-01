import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { ref } from 'vue'
import Keybar from '~/components/Keybar.vue'

beforeAll(async () => {
  const app = await mountSuspended({ template: '<div />' })
  app.unmount()
}, 60_000)

let unmount: (() => void) | undefined
afterEach(() => { unmount?.(); unmount = undefined; vi.restoreAllMocks() })

async function mounted(focused = false) {
  let has = focused
  const ctl = {
    virtualModifiers: ref([]), toggleModifier: vi.fn(), sendVirtualKey: vi.fn(), kbdOn: ref(focused),
    hasFocus: () => has,
    focus: vi.fn(() => { has = true }), blur: vi.fn(() => { has = false }),
  }
  const w = await mountSuspended(Keybar, { props: { ctl: ctl as unknown as TerminalCtl } })
  unmount = () => w.unmount()
  const btn = w.get('button[aria-label="Type in terminal"]')
  // The button sits at (0, 0) in happy-dom: a lift at (5, 5) is on it.
  const touch = (type: string, x = 5, y = 5) => btn.trigger(type, {
    touches: type === 'touchend' ? [] : [{ identifier: 1, clientX: x, clientY: y }],
    changedTouches: [{ identifier: 1, clientX: x, clientY: y }],
  })
  return { ctl, btn, touch }
}

describe('key bar keyboard button', () => {
  // iOS: with a tap on the terminal no longer opening the keyboard, this button
  // is the way to it, so it must not depend on the click Safari may drop.
  it('opens the keyboard on the touch itself, without waiting for a click', async () => {
    const r = await mounted()
    await r.touch('touchstart')
    await r.touch('touchend')
    expect(r.ctl.focus).toHaveBeenCalledOnce()
    // The click the browser may still make of that touch does not undo it.
    await r.btn.trigger('click')
    expect(r.ctl.blur).not.toHaveBeenCalled()
    expect(r.ctl.focus).toHaveBeenCalledOnce()
  })
  it('closes the keyboard on a touch when the terminal has it', async () => {
    const r = await mounted(true)
    await r.touch('touchstart')
    await r.touch('touchend')
    expect(r.ctl.blur).toHaveBeenCalledOnce()
    expect(r.ctl.focus).not.toHaveBeenCalled()
  })
  it('does nothing when the finger scrolls the bar', async () => {
    const r = await mounted()
    await r.touch('touchstart', 5, 5)
    await r.touch('touchmove', 40, 5)
    await r.touch('touchend', 40, 5)
    expect(r.ctl.focus).not.toHaveBeenCalled()
  })
  it('still works with a mouse click', async () => {
    const r = await mounted()
    await r.btn.trigger('click')
    expect(r.ctl.focus).toHaveBeenCalledOnce()
  })
})
