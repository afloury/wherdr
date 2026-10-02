// Selection and copy in an xterm terminal (computer), like a native
// terminal: dragging near the top or bottom edge scrolls and the selection
// continues; on release, the text is copied.
// Herdr keeps the history (scrollback 0 on the xterm side): xterm cannot
// scroll by itself during a selection. So wherdr drives the drag itself:
// scrolling requested from Herdr, lines seen remembered by absolute position,
// highlighting of the visible part with term.select().
import type { Terminal } from '@xterm/xterm'

type Keys = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>
type Press = Pick<MouseEvent, 'button' | 'detail' | 'shiftKey' | 'altKey'>

// ⌘C (Mac) ou Ctrl+Shift+C (ailleurs). Ctrl+C reste au programme.
export function isTerminalCopyKey(e: Keys): boolean {
  return e.key.toLowerCase() === 'c' && !e.altKey && (e.metaKey || (e.ctrlKey && e.shiftKey))
}

// Does the drag belong to wherdr? Left button, single click (double and triple
// click: word / line selection by xterm). If the program tracks the mouse,
// it keeps the bare drag; Shift or ⌥ + drag selects anyway, as
// in Terminal, iTerm or Ghostty. wherdr declares `mouse_capture: false` to
// Herdr: mouse mode should not happen.
export function ownsDrag(e: Press, mouseTracking: boolean): boolean {
  if (e.button !== 0 || e.detail > 1) return false
  return !mouseTracking || e.shiftKey || e.altKey
}

// --- Edge scrolling --------------------------------------------------------
// Speed in lines per second (positive = towards the top of the history) according to
// the pointer position: a one-line zone along each edge, then faster
// the further away, capped. 0 in the zone.
export const EDGE_MAX_SPEED = 80
export function edgeScrollSpeed(y: number, top: number, bottom: number, rowHeight: number): number {
  const h = rowHeight > 0 ? rowHeight : 16
  const depth = y < top + h ? top + h - y : y > bottom - h ? -(y - (bottom - h)) : 0
  if (!depth) return 0
  return Math.sign(depth) * Math.min(EDGE_MAX_SPEED, 4 + 12 * Math.abs(depth) / h)
}

// Whole lines to request for `dt` ms, and the remainder kept.
export function edgeLines(speed: number, dtMs: number, acc: number, maxLines: number): { lines: number, rest: number } {
  const total = acc + speed * dtMs / 1000
  const lines = Math.max(-maxLines, Math.min(maxLines, Math.trunc(total)))
  return { lines, rest: lines === Math.trunc(total) ? total - lines : 0 }
}

// Offset k such that line i of the old screen is line i + k of the
// new one (k > 0: the text moves down, we go up in the history). `hint`:
// expected offset, preferred on a tie. null: unrelated screens.
export function findShift(before: string[], after: string[], hint = 0): number | null {
  const rows = Math.min(before.length, after.length)
  if (!rows) return null
  const order = [hint, 0]
  for (let d = 1; d < rows; d++) order.push(d, -d)
  let best: number | null = null
  let bestScore = 0
  for (const k of new Set(order)) {
    if (Math.abs(k) >= rows) continue
    let seen = 0
    let same = 0
    for (let i = Math.max(0, -k); i < rows && i + k < rows; i++) {
      const a = before[i]!.trimEnd()
      const b = after[i + k]!.trimEnd()
      if (!a && !b) continue
      seen++
      if (a === b) same++
    }
    // Au moins deux lignes non vides en commun, presque toutes identiques.
    if (seen < 2 || same / seen < 0.9) continue
    // The expected offset, if it fits, wins (repetitive screens).
    if (k === hint) return k
    if (same > bestScore) {
      best = k
      bestScore = same
    }
  }
  return best
}

// Selection point as an absolute line (0 = first line on screen at the start
// of the drag, negative = higher up in the history) and column.
export interface Cell { row: number, col: number }

export function ordered(a: Cell, b: Cell): [Cell, Cell] {
  return a.row < b.row || (a.row === b.row && a.col <= b.col) ? [a, b] : [b, a]
}

// Visible part of a selection (exclusive end), in term.select() format,
// or null if it is entirely off screen.
export function visibleRange(s: { startX: number, startY: number, endX: number, endY: number }, cols: number, rows: number): { column: number, row: number, length: number } | null {
  const sy = Math.max(0, s.startY)
  const sx = s.startY < 0 ? 0 : s.startX
  const ey = Math.min(rows - 1, s.endY)
  const ex = s.endY > rows - 1 ? cols : s.endX
  const length = (ey - sy) * cols + ex - sx
  if (s.endY < 0 || s.startY > rows - 1 || length <= 0) return null
  return { column: sx, row: sy, length }
}

// Text between two points (exclusive end) from the remembered lines.
export function selectionText(lines: Map<number, string>, a: Cell, b: Cell): string {
  const [s, e] = ordered(a, b)
  const out: string[] = []
  for (let r = s.row; r <= e.row; r++) {
    const line = lines.get(r) ?? ''
    out.push(line.slice(r === s.row ? s.col : 0, r === e.row ? e.col : undefined).trimEnd())
  }
  // Empty lines below the text (bottom of the screen): not copied.
  while (out.length > 1 && !out[out.length - 1]) out.pop()
  return out.join('\n')
}

// --- Edge scroll driver ----------------------------------------------------
// Asks Herdr for lines at the pointer's speed, one request in flight at a
// time. A frame that does not move the text (spinner, status line, cursor)
// is not the answer: the request stays pending. No moving frame within the
// wait (at least `wait` ms, more on a slow link) means Herdr is probably at
// the end in that direction: requests pause, then retry every `retry` ms
// while the pointer stays past the edge, so a late frame never stops the
// scrolling for good.
export interface EdgeScroller {
  // Every timer tick, with the current speed (edgeScrollSpeed).
  tick: (now: number, speed: number, maxLines: number) => void
  // Lines requested and not seen yet (hint for findShift).
  pending: () => number
  // Shift measured on a new frame.
  seen: (shift: number, now: number) => void
  reset: (now: number) => void
}

export function createEdgeScroller(send: (lines: number) => boolean, wait = 350, retry = 1000): EdgeScroller {
  let pending = 0
  let pendingAt = 0
  let exhausted = 0 // direction where Herdr has nothing left (1 up, -1 down)
  let exhaustedAt = 0
  let late = 0 // when the last timed-out request was sent
  let rtt = 0 // smoothed request -> moving frame delay
  let acc = 0
  let lastTick = 0
  return {
    tick(now, speed, maxLines) {
      const dt = Math.min(200, now - lastTick)
      lastTick = now
      if (!speed) {
        acc = 0
        exhausted = 0
        return
      }
      if (Math.sign(speed) !== exhausted || now - exhaustedAt >= retry) exhausted = 0
      if (exhausted) return
      if (pending) {
        if (now - pendingAt > Math.min(2000, Math.max(wait, 3 * rtt))) {
          exhausted = Math.sign(pending)
          exhaustedAt = now
          late = pendingAt
          pending = 0
          acc = 0
        }
        return
      }
      const step = edgeLines(speed, dt, acc, maxLines)
      acc = step.rest
      if (step.lines && send(step.lines)) {
        pending = step.lines
        pendingAt = now
      }
    },
    pending: () => pending,
    seen(shift, now) {
      if (!shift) return
      // Answer to the pending request, or a late one: Herdr was not at the end.
      const at = pending ? pendingAt : late
      if (!at) return
      const d = now - at
      rtt = rtt ? rtt * 0.7 + d * 0.3 : d
      pending = 0
      late = 0
      exhausted = 0
    },
    reset(now) {
      pending = 0
      late = 0
      exhausted = 0
      acc = 0
      lastTick = now
    },
  }
}

// --- Drag lifecycle ---------------------------------------------------------
// Once the button is down in the terminal, the drag follows the pointer
// everywhere: outside the terminal, outside the window (pointer capture).
// Release anywhere ends it; Esc cancels it; losing the pointer (cancel,
// capture lost, window blurred) stops it so nothing keeps scrolling.
export type DragEnd = 'release' | 'escape' | 'lost'

interface Capturable extends EventTarget {
  setPointerCapture?: (id: number) => void
  releasePointerCapture?: (id: number) => void
  hasPointerCapture?: (id: number) => boolean
}

export function trackDrag(
  win: EventTarget,
  el: Capturable,
  pointerId: number | null,
  h: { move: (x: number, y: number) => void, end: (how: DragEnd) => void },
): () => void {
  // Object form: some EventTarget implementations mismatch a boolean on removal.
  const CAPTURE = { capture: true }
  let done = false
  const stop = (how: DragEnd | null) => {
    if (done) return
    done = true
    win.removeEventListener('pointermove', onMove, CAPTURE)
    win.removeEventListener('pointerup', onUp, CAPTURE)
    win.removeEventListener('pointercancel', onLost, CAPTURE)
    win.removeEventListener('blur', onLost)
    win.removeEventListener('keydown', onKey, CAPTURE)
    el.removeEventListener('lostpointercapture', onLost)
    if (pointerId !== null) {
      try {
        if (el.hasPointerCapture?.(pointerId)) el.releasePointerCapture?.(pointerId)
      } catch { /* pointer already gone */ }
    }
    if (how) h.end(how)
  }
  const mine = (e: Event) => pointerId === null || (e as PointerEvent).pointerId === undefined || (e as PointerEvent).pointerId === pointerId
  const onMove = (e: Event) => {
    if (!mine(e)) return
    const p = e as PointerEvent
    h.move(p.clientX, p.clientY)
  }
  const onUp = (e: Event) => {
    if (!mine(e)) return
    const p = e as PointerEvent
    h.move(p.clientX, p.clientY)
    stop('release')
  }
  const onLost = (e: Event) => {
    if (e.type !== 'blur' && !mine(e)) return
    stop('lost')
  }
  const onKey = (e: Event) => {
    if ((e as KeyboardEvent).key !== 'Escape') return
    // The running program must not receive this Esc (it would interrupt an agent).
    e.preventDefault()
    e.stopImmediatePropagation()
    stop('escape')
  }
  win.addEventListener('pointermove', onMove, CAPTURE)
  win.addEventListener('pointerup', onUp, CAPTURE)
  win.addEventListener('pointercancel', onLost, CAPTURE)
  win.addEventListener('blur', onLost)
  win.addEventListener('keydown', onKey, CAPTURE)
  if (pointerId !== null) {
    try {
      el.setPointerCapture?.(pointerId)
      el.addEventListener('lostpointercapture', onLost)
    } catch { /* pointer no longer active: window listeners still follow it */ }
  }
  return () => stop(null)
}

// Plain Ctrl+C while a selection is waiting to be copied (the copy on release
// was refused): copies it, like Windows Terminal. Otherwise it stays with the program.
export function isPendingCopyKey(e: Keys): boolean {
  return e.key.toLowerCase() === 'c' && e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey
}

// Copy: clipboard API, otherwise execCommand (insecure context).
// The clipboard API is called synchronously, before the first await, so it
// stays inside the caller's user gesture.
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* refused: we try the old method */ }
  return execCopy(text)
}

function execCopy(text: string): boolean {
  try {
    const active = document.activeElement as HTMLElement | null
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    active?.focus?.({ preventScroll: true })
    return ok
  } catch { return false }
}

// --- Early copy -------------------------------------------------------------
// Browsers only allow a clipboard write during a transient user activation:
// in Chromium, the mousedown that starts the drag grants it for about 5 s, and
// a mouse release grants none. A long drag (edge scrolling) ends after it has
// expired, so writeText on release is refused. The write is therefore started
// while the activation is still fresh (first move of the drag), with the text
// as a promise (ClipboardItem) resolved on release.
export interface EarlyCopy {
  // The write was refused before the text was even given (Safari outside a gesture).
  failed: () => boolean
  // Gives the final text; true once it is in the clipboard.
  resolve: (text: string) => Promise<boolean>
  // Drag cancelled: nothing is written.
  cancel: () => void
}

interface ClipboardLike { write?: (items: ClipboardItem[]) => Promise<void> }
type ClipboardItemCtor = new (items: Record<string, Promise<Blob>>) => ClipboardItem

export function startEarlyCopy(
  clipboard: ClipboardLike | undefined = globalThis.navigator?.clipboard,
  Item: ClipboardItemCtor | undefined = (globalThis as { ClipboardItem?: ClipboardItemCtor }).ClipboardItem,
): EarlyCopy | null {
  if (!clipboard?.write || !Item) return null
  let give!: (text: string) => void
  let drop!: (err: Error) => void
  const text = new Promise<string>((resolve, reject) => {
    give = resolve
    drop = reject
  })
  const blob = text.then(t => new Blob([t], { type: 'text/plain' }))
  blob.catch(() => {}) // cancelled: not an unhandled rejection
  let refused = false
  let result: Promise<boolean>
  try {
    result = clipboard.write([new Item({ 'text/plain': blob })]).then(() => true, () => {
      refused = true
      return false
    })
  } catch { return null }
  let settled = false
  return {
    failed: () => refused,
    resolve(t) {
      if (!settled) give(t)
      settled = true
      return result
    },
    cancel() {
      if (!settled) drop(new Error('cancelled'))
      settled = true
    },
  }
}

// Copy on release: the early write if it is still alive, otherwise (or if it
// fails) the clipboard API then execCommand, started synchronously so a
// release that still carries an activation (Safari) can use it.
export async function copyOnRelease(text: string, early: EarlyCopy | null, copy: (t: string) => Promise<boolean> = copyText): Promise<boolean> {
  if (early && !early.failed()) {
    if (await early.resolve(text)) return true
    return copy(text)
  }
  early?.cancel()
  return copy(text)
}

function screenLines(term: Terminal): string[] {
  const buf = term.buffer.active
  const out: string[] = []
  for (let y = 0; y < term.rows; y++) out.push(buf.getLine(buf.viewportY + y)?.translateToString(true) ?? '')
  return out
}

export interface SelectionOptions {
  // Asks Herdr to scroll (positive = upwards). false: no
  // history to browse (mirror), the edge does nothing.
  scroll?: (lines: number) => boolean
  // The drag is taken before xterm: wherdr gives the focus.
  focus?: () => void
  // Discreet feedback after copying on release or with the shortcut.
  copied?: (ok: boolean) => void
  // The copy on release was refused (activation expired, release outside the
  // window): the selection stays, Ctrl+C / ⌘C or `copy` (call it from a
  // click, a fresh gesture) copies it. Without it, `copied(false)`.
  ready?: (copy: () => void) => void
}

export interface TerminalSelection {
  // To call once the frame is written (term.write callback).
  frame: () => void
  dispose: () => void
}

// Maximum wait for the frame after a scroll request: without a frame,
// Herdr had nothing more to show in that direction.
const SCROLL_WAIT = 350
const TICK = 50

export function bindTerminalSelection(term: Terminal, opts: SelectionOptions = {}): TerminalSelection {
  const root = term.element
  if (!root) return { frame() {}, dispose() {} }
  let last = screenLines(term)

  // Drag in progress (or last selection made by dragging).
  let drag: {
    anchor: Cell, focus: Cell, moved: boolean
    offset: number // lines scrolled up since the start of the drag
    lines: Map<number, string>
    x: number, y: number
  } | null = null
  let active = false // button still pressed
  let text = '' // text of the selection made by dragging
  const edge = createEdgeScroller(lines => opts.scroll?.(lines) ?? false, SCROLL_WAIT)
  let timer: ReturnType<typeof setInterval> | undefined
  let untrack: (() => void) | null = null
  let pointerId: number | null = null
  let rendering = false
  let early: EarlyCopy | null = null // clipboard write started during the drag
  let waiting = false // selection whose copy was refused: plain Ctrl+C copies it

  const screenRect = () => (root.querySelector('.xterm-screen') as HTMLElement | null ?? root).getBoundingClientRect()
  const cellAt = (x: number, y: number): Cell => {
    const r = screenRect()
    const w = r.width / term.cols
    const h = r.height / term.rows
    if (y < r.top) return { row: -drag!.offset, col: 0 }
    if (y >= r.bottom) return { row: term.rows - 1 - drag!.offset, col: term.cols }
    const row = Math.min(term.rows - 1, Math.floor((y - r.top) / h))
    const col = Math.max(0, Math.min(term.cols, Math.round((x - r.left) / w)))
    return { row: row - drag!.offset, col }
  }
  const remember = (screen: string[]) => {
    if (!drag) return
    screen.forEach((l, y) => drag!.lines.set(y - drag!.offset, l))
  }
  const render = () => {
    if (!drag) return
    const [s, e] = ordered(drag.anchor, drag.focus)
    const r = visibleRange({ startX: s.col, startY: s.row + drag.offset, endX: e.col, endY: e.row + drag.offset }, term.cols, term.rows)
    rendering = true
    try {
      if (r && (s.row !== e.row || s.col !== e.col)) term.select(r.column, r.row, r.length)
      else term.clearSelection()
    } finally { rendering = false }
    text = selectionText(drag.lines, drag.anchor, drag.focus)
  }
  const extend = () => {
    if (!drag) return
    drag.focus = cellAt(drag.x, drag.y)
    if (!drag.moved && (drag.focus.row !== drag.anchor.row || drag.focus.col !== drag.anchor.col)) {
      drag.moved = true
      // Still within the mousedown's activation: start the write now.
      if (active) early = startEarlyCopy()
    }
    render()
  }

  const tick = () => {
    if (!drag || !active || !opts.scroll) return
    const r = screenRect()
    edge.tick(performance.now(), edgeScrollSpeed(drag.y, r.top, r.bottom, r.height / term.rows), Math.max(1, term.rows - 2))
  }

  const dropEarly = () => {
    early?.cancel()
    early = null
  }
  const copyNow = (t: string) => {
    void copyText(t).then((ok) => {
      if (ok) waiting = false
      opts.copied?.(ok)
    })
  }
  const clear = () => {
    drag = null
    text = ''
    waiting = false
    rendering = true
    try { term.clearSelection() } finally { rendering = false }
  }
  const finish = (how: DragEnd | null) => {
    untrack = null
    clearInterval(timer)
    timer = undefined
    if (!active) return
    active = false
    if (how === 'escape' || (drag && !drag.moved)) {
      dropEarly()
      return clear()
    }
    const pending = early
    early = null
    if (!text) return pending?.cancel()
    // Pointer lost (window left, cancelled): the selection stays, ⌘C copies it.
    if (how !== 'release') {
      pending?.cancel()
      waiting = true
      return
    }
    const t = text
    void copyOnRelease(t, pending).then((ok) => {
      if (ok || !opts.ready) return opts.copied?.(ok)
      // Refused: no error, the selection is ready for the shortcut or a click.
      // Ctrl+C only while this selection is still the current one.
      if (text === t) waiting = true
      opts.ready(() => copyNow(t))
    })
  }
  // pointerdown comes just before mousedown: its id is used for the capture.
  const onPointerDown = (e: PointerEvent) => { pointerId = e.pointerId }
  const onDown = (e: MouseEvent) => {
    if (!ownsDrag(e, term.modes.mouseTrackingMode !== 'none')) {
      // Double or triple click: xterm selects; we copy on release.
      if (e.button === 0 && e.detail > 1) {
        drag = null
        window.addEventListener('mouseup', () => setTimeout(() => {
          const t = term.getSelection()
          if (t) void copyText(t).then(ok => opts.copied?.(ok))
        }), { capture: true, once: true })
      }
      return
    }
    e.preventDefault()
    e.stopImmediatePropagation()
    opts.focus?.()
    last = screenLines(term)
    dropEarly()
    waiting = false
    drag = { anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 }, moved: false, offset: 0, lines: new Map(), x: e.clientX, y: e.clientY }
    remember(last)
    drag.anchor = cellAt(e.clientX, e.clientY)
    drag.focus = drag.anchor
    text = ''
    active = true
    term.clearSelection()
    edge.reset(performance.now())
    clearInterval(timer)
    timer = setInterval(tick, TICK)
    untrack?.()
    untrack = trackDrag(window, root, pointerId, {
      move: (x, y) => {
        if (!drag || !active) return
        drag.x = x
        drag.y = y
        extend()
      },
      end: finish,
    })
  }
  const onKey = (e: KeyboardEvent) => {
    const pendingKey = waiting && !active && !!text && isPendingCopyKey(e)
    if (!isTerminalCopyKey(e) && !pendingKey) return
    const t = (drag && text) || term.getSelection()
    if (!t) return
    e.preventDefault()
    e.stopPropagation()
    copyNow(t)
  }
  // New selection by xterm (double click, keyboard): ours is over.
  const sub = term.onSelectionChange(() => {
    if (rendering || active) return
    drag = null
    text = ''
    waiting = false
  })

  root.addEventListener('keydown', onKey, true)
  root.addEventListener('pointerdown', onPointerDown, true)
  root.addEventListener('mousedown', onDown, true)

  return {
    frame() {
      const now = screenLines(term)
      const before = last
      last = now
      if (!drag) return
      if (now.length !== before.length) {
        // Resized: the coordinates no longer make sense.
        edge.reset(performance.now())
        clear()
        return
      }
      if (!active) {
        // Selection finished: like a native terminal, it clears when
        // the text under it moves (scrolling, new output).
        if (now.some((l, i) => l !== before[i])) clear()
        return
      }
      const hint = edge.pending()
      let k = findShift(before, now, hint)
      // Big jump (screens without a common line): we trust the requested lines.
      if (k === null) k = hint
      // k = 0: an unrelated frame (spinner…), the scroll is still awaited.
      edge.seen(k, performance.now())
      drag.offset += k
      remember(now)
      extend()
    },
    dispose() {
      untrack?.()
      finish(null)
      sub.dispose()
      root.removeEventListener('keydown', onKey, true)
      root.removeEventListener('pointerdown', onPointerDown, true)
      root.removeEventListener('mousedown', onDown, true)
    },
  }
}
