import type { Terminal } from '@xterm/xterm'

// CoreTerminal.scroll is public in the implementation but outside xterm's
// documented API. The browser and headless terminals both wrap that core.
type ScrollCore = {
  scroll?: (eraseAttr: unknown) => void
  _core?: ScrollCore
  _inputHandler?: { _eraseAttrData?: () => unknown }
  buffers?: {
    active?: {
      ybase: number
      scrollTop?: number
      scrollBottom?: number
      lines: { get: (y: number) => { getTrimmedLength: () => number } | undefined }
    }
  }
}

function scrollCore(term: Terminal): ScrollCore | undefined {
  const inner = term as unknown as ScrollCore
  return typeof inner.scroll === 'function' ? inner : inner._core
}

// xterm 6's scrollOnEraseInDisplay, for xterm 5.5: ED 2 moves the non-empty
// part of the screen into the scrollback instead of erasing it in place. The
// erase attribute is the input handler's own, so a background-color erase keeps
// xterm's back-color-erase behavior. Only when the scroll region is the whole
// screen: scroll() moves the lines inside the region only, so a smaller one
// would leave old rows on screen; xterm then erases as stock.
export function scrollScreenIntoScrollback(term: Terminal): boolean {
  const core = scrollCore(term)
  const eraseAttr = core?._inputHandler?._eraseAttrData?.()
  const buffer = core?.buffers?.active
  if (!core?.scroll || !eraseAttr || !buffer) return false
  if (buffer.scrollTop !== 0 || buffer.scrollBottom !== term.rows - 1) return false
  let last = -1
  for (let row = term.rows - 1; row >= 0; row--) {
    if ((buffer.lines.get(buffer.ybase + row)?.getTrimmedLength() ?? 0) > 0) { last = row; break }
  }
  for (let row = 0; row <= last; row++) core.scroll(eraseAttr)
  return true
}

export function registerEraseInDisplay(term: Terminal, keepSavedLines: () => boolean, screenErased: () => void) {
  return term.parser.registerCsiHandler({ final: 'J' }, (params) => {
    if (!keepSavedLines()) return false
    if (params[0] === 3) return true
    if (params[0] === 2) {
      screenErased()
      return scrollScreenIntoScrollback(term)
    }
    return false
  })
}
