// A button that acts on the touch itself, not on the click the browser makes of it.
//
// iPhone, keyboard open: the layout viewport is taller than the visible area, so
// the page can pan. A finger that drifts by a pixel or two on a small button
// starts that pan, and Safari then never sends the synthetic click: the tap does
// nothing until the keyboard is closed. Handling the touch avoids it:
// - touchstart is cancelled, so no pan starts from the button and no mouse
//   events follow (the field keeps the focus, the keyboard stays up);
// - the action runs on touchend, when the finger lifts on the button (with some
//   slop around it, the size of its enlarged touch area and more);
// - a finger that slides away from the button cancels, as with a click.

// How far outside the button's box the finger may lift and still count (px).
export const TAP_SLOP = 20

interface TapBox { left: number, top: number, right: number, bottom: number }

export function liftsOn(box: TapBox, x: number, y: number, slop = TAP_SLOP): boolean {
  return x >= box.left - slop && x <= box.right + slop && y >= box.top - slop && y <= box.bottom + slop
}

interface TouchPoint { identifier: number, clientX: number, clientY: number }
interface TouchLike {
  touches: ArrayLike<TouchPoint>
  changedTouches: ArrayLike<TouchPoint>
  currentTarget: EventTarget | null
  preventDefault(): void
}

export function createTouchTap(o: {
  // Whether a touch now would act (the button is not disabled).
  enabled: () => boolean
  run: () => void
  // Pressed state, for the look of :active (cancelling touchstart can drop it on iOS).
  press?: (on: boolean) => void
  slop?: number
}) {
  let id: number | null = null
  const reset = () => {
    if (id !== null) o.press?.(false)
    id = null
  }
  return {
    start(e: TouchLike) {
      reset()
      const t = e.changedTouches[0]
      if (e.touches.length !== 1 || !t || !o.enabled()) return
      e.preventDefault()
      id = t.identifier
      o.press?.(true)
    },
    end(e: TouchLike) {
      if (id === null) return
      const t = Array.from(e.changedTouches).find(c => c.identifier === id)
      if (!t) return
      reset()
      e.preventDefault()
      const el = e.currentTarget as Element | null
      if (el && liftsOn(el.getBoundingClientRect(), t.clientX, t.clientY, o.slop) && o.enabled()) o.run()
    },
    cancel: reset,
  }
}
