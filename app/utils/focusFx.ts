// TEMPORARY (design proposals): which animated border the message field gets
// while it has the focus. "0" is the current one (plain 1 px accent border);
// "a" to "c" are the proposals, picked with `?focusfx=a` in the address
// (remembered on the device) and applied as `data-focusfx` on <html>
// (main.css). Removed once one is chosen.
export const FOCUS_FX = ['0', 'a', 'b', 'c'] as const
export type FocusFx = typeof FOCUS_FX[number]

const valid = (v: unknown): v is FocusFx => FOCUS_FX.includes(v as FocusFx)

export function pickFocusFx(query: string | null, stored: string | null): FocusFx {
  if (valid(query)) return query
  return valid(stored) ? stored : '0'
}

export function installFocusFx() {
  try {
    const q = new URLSearchParams(location.search).get('focusfx')
    const v = pickFocusFx(q, localStorage.getItem('focusFx'))
    if (valid(q)) localStorage.setItem('focusFx', q)
    document.documentElement.dataset.focusfx = v
  } catch { document.documentElement.dataset.focusfx = '0' }
}
