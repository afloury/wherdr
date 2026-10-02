import { describe, expect, it, vi } from 'vitest'
import { copyOnRelease, createEdgeScroller, EDGE_MAX_SPEED, edgeLines, edgeScrollSpeed, findShift, isPendingCopyKey, isTerminalCopyKey, ownsDrag, selectionText, startEarlyCopy, trackDrag, visibleRange, type DragEnd, type EarlyCopy } from '../app/utils/terminalSelection'

const key = (mods: Partial<Parameters<typeof isTerminalCopyKey>[0]>) => ({
  key: 'c', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods,
})
const press = (mods: Partial<Parameters<typeof ownsDrag>[0]>) => ({ button: 0, detail: 1, shiftKey: false, altKey: false, ...mods })

describe('terminal copy shortcut', () => {
  it('accepts Command+C and Ctrl+Shift+C', () => {
    expect(isTerminalCopyKey(key({ metaKey: true }))).toBe(true)
    expect(isTerminalCopyKey(key({ ctrlKey: true, shiftKey: true }))).toBe(true)
    expect(isTerminalCopyKey(key({ key: 'C', ctrlKey: true, shiftKey: true }))).toBe(true)
  })

  it('leaves Ctrl+C and Option+C to the running program', () => {
    expect(isTerminalCopyKey(key({ ctrlKey: true }))).toBe(false)
    expect(isTerminalCopyKey(key({ altKey: true, metaKey: true }))).toBe(false)
    expect(isTerminalCopyKey(key({ key: 'v', metaKey: true }))).toBe(false)
  })
})

describe('drag ownership', () => {
  it('takes plain and Shift drags when the program does not track the mouse', () => {
    expect(ownsDrag(press({}), false)).toBe(true)
    expect(ownsDrag(press({ shiftKey: true }), false)).toBe(true)
  })

  it('leaves the plain drag to a mouse-tracking program, Shift or Option still select', () => {
    expect(ownsDrag(press({}), true)).toBe(false)
    expect(ownsDrag(press({ shiftKey: true }), true)).toBe(true)
    expect(ownsDrag(press({ altKey: true }), true)).toBe(true)
  })

  it('leaves double clicks and other buttons to xterm', () => {
    expect(ownsDrag(press({ detail: 2 }), false)).toBe(false)
    expect(ownsDrag(press({ button: 2 }), false)).toBe(false)
  })
})

describe('edge auto-scroll', () => {
  // Area from 100 to 500 px, 20 px lines.
  it('does not scroll inside the area', () => {
    expect(edgeScrollSpeed(300, 100, 500, 20)).toBe(0)
    expect(edgeScrollSpeed(121, 100, 500, 20)).toBe(0)
    expect(edgeScrollSpeed(479, 100, 500, 20)).toBe(0)
  })

  it('scrolls up near the top and down near the bottom', () => {
    expect(edgeScrollSpeed(110, 100, 500, 20)).toBeGreaterThan(0)
    expect(edgeScrollSpeed(490, 100, 500, 20)).toBeLessThan(0)
  })

  it('goes faster the farther the pointer is past the edge, up to a cap', () => {
    const near = edgeScrollSpeed(95, 100, 500, 20)
    const far = edgeScrollSpeed(20, 100, 500, 20)
    expect(far).toBeGreaterThan(near)
    expect(-edgeScrollSpeed(560, 100, 500, 20)).toBeGreaterThan(-edgeScrollSpeed(505, 100, 500, 20))
    expect(edgeScrollSpeed(-5000, 100, 500, 20)).toBe(EDGE_MAX_SPEED)
    expect(edgeScrollSpeed(9000, 100, 500, 20)).toBe(-EDGE_MAX_SPEED)
  })

  it('turns a speed into whole lines, keeping the fraction', () => {
    expect(edgeLines(10, 50, 0, 20)).toEqual({ lines: 0, rest: 0.5 })
    expect(edgeLines(10, 50, 0.5, 20)).toEqual({ lines: 1, rest: 0 })
    expect(edgeLines(-40, 50, 0, 20)).toEqual({ lines: -2, rest: 0 })
    // Capped at less than one screen per step: the offset stays measurable.
    expect(edgeLines(EDGE_MAX_SPEED, 1000, 0, 20)).toEqual({ lines: 20, rest: 0 })
  })
})

describe('selected text', () => {
  const lines = new Map([[-2, 'alpha one'], [-1, 'beta two  '], [0, 'gamma three'], [1, 'delta']])
  it('joins the rows between the two points, whatever the drag direction', () => {
    expect(selectionText(lines, { row: -2, col: 6 }, { row: 0, col: 5 })).toBe('one\nbeta two\ngamma')
    expect(selectionText(lines, { row: 0, col: 5 }, { row: -2, col: 6 })).toBe('one\nbeta two\ngamma')
    expect(selectionText(lines, { row: 1, col: 0 }, { row: 1, col: 3 })).toBe('del')
  })

  it('drops the blank rows below the text', () => {
    expect(selectionText(lines, { row: 1, col: 0 }, { row: 4, col: 10 })).toBe('delta')
  })
})

describe('scroll measurement', () => {
  const screen = (from: number, rows = 6) => Array.from({ length: rows }, (_, i) => `line ${from + i}`)

  it('finds how far the text moved', () => {
    expect(findShift(screen(10), screen(10))).toBe(0)
    expect(findShift(screen(10), screen(7))).toBe(3) // towards the top of the history
    expect(findShift(screen(10), screen(12))).toBe(-2)
  })

  it('gives up on unrelated screens', () => {
    expect(findShift(screen(10), screen(100))).toBeNull()
    expect(findShift(screen(10), ['', '', '', '', '', ''])).toBeNull()
  })

  it('prefers the expected shift on repetitive screens', () => {
    const same = ['a', 'b', 'a', 'b', 'a', 'b']
    expect(findShift(same, same, 2)).toBe(2)
    expect(findShift(same, same)).toBe(0)
  })

  it('clips a moved selection to the screen', () => {
    const sel = { startX: 4, startY: 1, endX: 3, endY: 2 }
    expect(visibleRange(sel, 10, 6)).toEqual({ column: 4, row: 1, length: 9 })
    expect(visibleRange({ ...sel, startY: -1, endY: 0 }, 10, 6)).toEqual({ column: 0, row: 0, length: 3 })
    expect(visibleRange({ ...sel, startY: 5, endY: 6 }, 10, 6)).toEqual({ column: 4, row: 5, length: 6 })
    expect(visibleRange({ ...sel, startY: -3, endY: -2 }, 10, 6)).toBeNull()
    expect(visibleRange({ ...sel, startY: 6, endY: 7 }, 10, 6)).toBeNull()
  })

})

describe('auto-scroll with the pointer beyond the edge', () => {
  // Terminal from 100 to 500 px, 20 px lines; pointer 100 px above / below.
  const above = edgeScrollSpeed(0, 100, 500, 20)
  const below = edgeScrollSpeed(600, 100, 500, 20)

  it('keeps scrolling, faster than inside the edge zone, capped', () => {
    expect(above).toBeGreaterThan(edgeScrollSpeed(110, 100, 500, 20))
    expect(above).toBeLessThanOrEqual(EDGE_MAX_SPEED)
    expect(below).toBeLessThan(edgeScrollSpeed(490, 100, 500, 20))
    expect(below).toBeGreaterThanOrEqual(-EDGE_MAX_SPEED)
  })

  const run = (speed: number, frames: (sent: number[], t: number) => number | undefined, ms = 2000) => {
    const sent: number[] = []
    const edge = createEdgeScroller((n) => { sent.push(n); return true }, 350)
    edge.reset(0)
    for (let t = 50; t <= ms; t += 50) {
      edge.tick(t, speed, 20)
      const k = frames(sent, t)
      if (k !== undefined) edge.seen(k, t)
    }
    return sent
  }

  it('requests lines on every tick while Herdr answers, with the pointer held still', () => {
    // Herdr answers each request on the next tick.
    const sent = run(above, s => s.at(-1))
    expect(sent.length).toBeGreaterThan(30)
    expect(sent.every(n => n > 0)).toBe(true)
  })

  it('is not stopped by frames that do not move the text (spinner)', () => {
    // A spinner frame (shift 0) lands on the tick after each request,
    // the scroll frame on the tick after that.
    let answered = 0
    let spun = false
    const sent = run(above, (s) => {
      if (s.length === answered) return undefined
      if (!spun) { spun = true; return 0 }
      spun = false
      answered = s.length
      return s.at(-1)
    })
    expect(sent.length).toBeGreaterThan(10)
  })

  it('pauses when Herdr has nothing more in that direction, retries, resumes the other way', () => {
    const sent: number[] = []
    const edge = createEdgeScroller((n) => { sent.push(n); return true }, 350, 1000)
    edge.reset(0)
    for (let t = 50; t <= 900; t += 50) {
      edge.tick(t, below, 20)
      edge.seen(0, t) // only spinner frames: the bottom is reached
    }
    expect(sent).toHaveLength(1)
    // Still held past the edge: one new try per second, not a request per tick.
    for (let t = 950; t <= 3000; t += 50) edge.tick(t, below, 20)
    expect(sent.length).toBeGreaterThan(1)
    expect(sent.length).toBeLessThanOrEqual(4)
    // The other way (once the last unanswered request has timed out).
    for (let t = 3050; t <= 3500; t += 50) edge.tick(t, above, 20)
    expect(sent.at(-1)).toBeGreaterThan(0)
  })

  it('keeps scrolling on a slow link (frames 600 ms after each request)', () => {
    const sent: number[] = []
    const edge = createEdgeScroller((n) => { sent.push(n); return true }, 350, 1000)
    edge.reset(0)
    const due: [number, number][] = []
    let count = 0
    for (let t = 50; t <= 10000; t += 50) {
      edge.tick(t, above, 20)
      if (sent.length > count) {
        count = sent.length
        due.push([t + 600, sent.at(-1)!])
      }
      while (due.length && due[0]![0] <= t) edge.seen(due.shift()![1], t)
    }
    // After the first late frame, the wait follows the link: about one request per 600 ms.
    expect(sent.length).toBeGreaterThan(12)
  })
})

describe('drag lifecycle', () => {
  const ev = (type: string, init: Record<string, unknown> = {}) => Object.assign(new Event(type, { cancelable: true }), { pointerId: 1, ...init })
  const setup = () => {
    const win = new EventTarget()
    const captured = new Set<number>()
    const el = Object.assign(new EventTarget(), {
      setPointerCapture: (id: number) => { captured.add(id) },
      releasePointerCapture: (id: number) => { captured.delete(id) },
      hasPointerCapture: (id: number) => captured.has(id),
    })
    const moves: [number, number][] = []
    const ends: DragEnd[] = []
    const untrack = trackDrag(win, el, 1, { move: (x, y) => moves.push([x, y]), end: how => ends.push(how) })
    return { win, el, captured, moves, ends, untrack }
  }

  it('captures the pointer and follows it outside the terminal', () => {
    const d = setup()
    expect(d.captured.has(1)).toBe(true)
    d.win.dispatchEvent(ev('pointermove', { clientX: 50, clientY: -100 }))
    expect(d.moves).toEqual([[50, -100]])
  })

  it('ends on release anywhere, once, and stops listening', () => {
    const d = setup()
    d.win.dispatchEvent(ev('pointerup', { clientX: 10, clientY: 900 }))
    expect(d.ends).toEqual(['release'])
    expect(d.moves.at(-1)).toEqual([10, 900])
    expect(d.captured.has(1)).toBe(false)
    d.win.dispatchEvent(ev('pointermove', { clientX: 1, clientY: 1 }))
    d.win.dispatchEvent(ev('pointerup'))
    d.el.dispatchEvent(ev('lostpointercapture'))
    expect(d.ends).toEqual(['release'])
    expect(d.moves).toHaveLength(1)
  })

  it.each(['pointercancel', 'blur'])('stops when the pointer is lost (%s)', (type) => {
    const d = setup()
    d.win.dispatchEvent(ev(type))
    expect(d.ends).toEqual(['lost'])
  })

  it('stops when the capture is lost', () => {
    const d = setup()
    d.el.dispatchEvent(ev('lostpointercapture'))
    expect(d.ends).toEqual(['lost'])
  })

  it('cancels on Esc without letting the program see the key', () => {
    const d = setup()
    const other = ev('keydown', { key: 'a' })
    d.win.dispatchEvent(other)
    expect(d.ends).toEqual([])
    const esc = ev('keydown', { key: 'Escape' })
    d.win.dispatchEvent(esc)
    expect(esc.defaultPrevented).toBe(true)
    expect(d.ends).toEqual(['escape'])
  })

  it('ignores other pointers and ends silently when disposed', () => {
    const d = setup()
    d.win.dispatchEvent(ev('pointerup', { pointerId: 7 }))
    expect(d.ends).toEqual([])
    d.untrack()
    d.win.dispatchEvent(ev('pointerup'))
    expect(d.ends).toEqual([])
    expect(d.captured.has(1)).toBe(false)
  })
})

describe('pending copy shortcut', () => {
  it('takes plain Ctrl+C only', () => {
    expect(isPendingCopyKey(key({ ctrlKey: true }))).toBe(true)
    expect(isPendingCopyKey(key({ key: 'C', ctrlKey: true }))).toBe(true)
    expect(isPendingCopyKey(key({ ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(isPendingCopyKey(key({ ctrlKey: true, altKey: true }))).toBe(false)
    expect(isPendingCopyKey(key({ metaKey: true }))).toBe(false)
    expect(isPendingCopyKey(key({ key: 'v', ctrlKey: true }))).toBe(false)
  })
})

describe('early clipboard write', () => {
  // A clipboard that waits for the item's promise, like Chromium, and can refuse.
  const fakeClipboard = (refuse: 'never' | 'now' | 'later' = 'never') => {
    const written: string[] = []
    const calls: number[] = []
    class Item {
      constructor(public data: Record<string, Promise<Blob>>) {}
    }
    const clipboard = {
      write: (items: ClipboardItem[]) => {
        calls.push(Date.now())
        if (refuse === 'now') return Promise.reject(new Error('NotAllowedError'))
        const blob = (items[0] as unknown as Item).data['text/plain']!
        return blob.then(async (b) => {
          if (refuse === 'later') throw new Error('NotAllowedError')
          written.push(await b.text())
        })
      },
    }
    return { clipboard, Item: Item as unknown as new (d: Record<string, Promise<Blob>>) => ClipboardItem, written, calls }
  }

  it('starts the write at once and writes the text given later', async () => {
    const f = fakeClipboard()
    const early = startEarlyCopy(f.clipboard, f.Item)!
    expect(f.calls).toHaveLength(1)
    expect(f.written).toEqual([])
    await expect(early.resolve('line 1\nline 2')).resolves.toBe(true)
    expect(f.written).toEqual(['line 1\nline 2'])
  })

  it('writes nothing when cancelled', async () => {
    const f = fakeClipboard()
    const early = startEarlyCopy(f.clipboard, f.Item)!
    early.cancel()
    await new Promise(r => setTimeout(r))
    expect(f.written).toEqual([])
    await expect(early.resolve('late')).resolves.toBe(false)
  })

  it('reports a write refused before the text is known', async () => {
    const f = fakeClipboard('now')
    const early = startEarlyCopy(f.clipboard, f.Item)!
    await new Promise(r => setTimeout(r))
    expect(early.failed()).toBe(true)
  })

  it('is unavailable without ClipboardItem or clipboard.write', () => {
    expect(startEarlyCopy(fakeClipboard().clipboard, undefined)).toBeNull()
    expect(startEarlyCopy({}, fakeClipboard().Item)).toBeNull()
    expect(startEarlyCopy(undefined, fakeClipboard().Item)).toBeNull()
  })
})

describe('copy on release', () => {
  const early = (state: { failed?: boolean, ok?: boolean }) => {
    const log: string[] = []
    const e: EarlyCopy = {
      failed: () => !!state.failed,
      resolve: (t) => {
        log.push(`early:${t}`)
        return Promise.resolve(!!state.ok)
      },
      cancel: () => { log.push('cancel') },
    }
    return { e, log }
  }

  it('uses the early write when it is alive', async () => {
    const { e, log } = early({ ok: true })
    const copy = vi.fn(async () => true)
    await expect(copyOnRelease('abc', e, copy)).resolves.toBe(true)
    expect(log).toEqual(['early:abc'])
    expect(copy).not.toHaveBeenCalled()
  })

  it('falls back to the regular copy when the early write fails', async () => {
    const { e, log } = early({ ok: false })
    const copy = vi.fn(async () => true)
    await expect(copyOnRelease('abc', e, copy)).resolves.toBe(true)
    expect(log).toEqual(['early:abc'])
    expect(copy).toHaveBeenCalledWith('abc')
  })

  it('copies synchronously, inside the release, when the early write was already refused', () => {
    const { e, log } = early({ failed: true })
    const copy = vi.fn(async () => false)
    void copyOnRelease('abc', e, copy)
    // Called before any await: still inside the release gesture.
    expect(copy).toHaveBeenCalledWith('abc')
    expect(log).toEqual(['cancel'])
  })

  it('copies synchronously without an early write, and reports a refusal', async () => {
    const copy = vi.fn(async () => false)
    const done = copyOnRelease('abc', null, copy)
    expect(copy).toHaveBeenCalledWith('abc')
    await expect(done).resolves.toBe(false)
  })
})
