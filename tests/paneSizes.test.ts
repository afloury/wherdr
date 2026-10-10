import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type PaneSize, cleanSavedSizes, createPaneSizes, parseSttySize } from '../server/utils/paneSizes'

const PANE = 'w1:p1'
const CLOSE_MS = 2000
const GRACE_MS = 30000

// A fake pane: its PTY keeps the last size it was given, as Herdr does when
// none of its own clients is attached.
function setup(opts: { exact?: boolean, start?: { cols: number, rows: number } } = {}) {
  const exact = opts.exact ?? true
  const pty = { ...(opts.start || { cols: 160, rows: 48 }) }
  let terminal = 'term_a'
  let gone = false
  let refuse = 0
  const resizes: string[] = []
  const logs: string[] = []
  const saved: Record<string, PaneSize>[] = []
  const sizes = createPaneSizes({
    // Without the PTY, the width is the one of Herdr's layout (120).
    read: async () => (gone ? null : { cols: exact ? pty.cols : 120, rows: pty.rows, exact, terminal }),
    resize: async (_pane, cols, rows) => {
      if (refuse-- > 0) return false
      resizes.push(`${cols}x${rows}`)
      Object.assign(pty, { cols, rows })
      return true
    },
    closeMs: CLOSE_MS,
    graceMs: GRACE_MS,
    retryMs: 1000,
    save: s => saved.push(s),
    log: m => logs.push(m),
  })
  // A wherdr terminal: opens a control session at the given size.
  async function open(cols: number, rows: number) {
    const hold = await sizes.hold(PANE)
    Object.assign(pty, { cols, rows })
    hold.resized(cols, rows)
    return hold
  }
  return {
    sizes, pty, resizes, logs, saved, open,
    native: (cols: number, rows: number) => Object.assign(pty, { cols, rows }),
    replaceTerminal: () => { terminal = 'term_b' },
    closePane: () => { gone = true },
    refuseNext: (n: number) => { refuse = n },
  }
}

const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms)

describe('pane size given back when wherdr’s terminal closes', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('gives the pane its original size back once the terminal is closed', async () => {
    const t = setup()
    const hold = await t.open(40, 20)
    expect(t.pty).toEqual({ cols: 40, rows: 20 })
    hold.release(true)
    await wait(CLOSE_MS - 1)
    expect(t.resizes).toEqual([])
    await wait(1)
    expect(t.resizes).toEqual(['160x48'])
    expect(t.pty).toEqual({ cols: 160, rows: 48 })
    expect(t.sizes.held()).toEqual([])
  })

  it('follows the resizes of the open terminal (keyboard, rotation)', async () => {
    const t = setup()
    const hold = await t.open(40, 20)
    t.native(40, 12)
    hold.resized(40, 12)
    hold.release(true)
    await wait(CLOSE_MS)
    expect(t.resizes).toEqual(['160x48'])
  })

  it('waits for the grace delay after a dropped connection', async () => {
    const t = setup()
    const hold = await t.open(40, 20)
    hold.release(false)
    await wait(GRACE_MS - 1)
    expect(t.resizes).toEqual([])
    await wait(1)
    expect(t.resizes).toEqual(['160x48'])
  })

  it('keeps the phone size when the terminal reconnects within the grace delay', async () => {
    const t = setup()
    const first = await t.open(40, 20)
    first.release(false)
    await wait(GRACE_MS / 2)
    const second = await t.open(40, 20)
    await wait(GRACE_MS * 2)
    expect(t.resizes).toEqual([])
    // The original size is still the one from before the first opening.
    second.release(true)
    await wait(CLOSE_MS)
    expect(t.resizes).toEqual(['160x48'])
  })

  it('only gives the size back when the last of several terminals closes', async () => {
    const t = setup()
    const phone = await t.open(40, 20)
    const tablet = await t.open(90, 30)
    phone.release(true)
    await wait(GRACE_MS * 2)
    expect(t.resizes).toEqual([])
    tablet.release(true)
    await wait(CLOSE_MS)
    expect(t.resizes).toEqual(['160x48'])
  })

  it('a terminal that never resized its pane gives nothing back', async () => {
    const t = setup()
    const term = await t.sizes.hold(PANE)
    term.release(true)
    await wait(GRACE_MS)
    expect(t.resizes).toEqual([])
    expect(t.sizes.held()).toEqual([])
  })

  it('ignores a second release of the same terminal', async () => {
    const t = setup()
    const phone = await t.open(40, 20)
    const tablet = await t.open(90, 30)
    phone.release(true)
    phone.release(true)
    await wait(GRACE_MS * 2)
    expect(t.resizes).toEqual([])
    tablet.release(true)
    await wait(CLOSE_MS)
    expect(t.resizes).toEqual(['160x48'])
  })

  it('leaves the size a Herdr client gave the pane meanwhile', async () => {
    const t = setup()
    const hold = await t.open(40, 20)
    hold.release(true)
    // Herdr lays the pane out again for its attached client.
    t.native(132, 40)
    await wait(CLOSE_MS)
    expect(t.resizes).toEqual([])
    expect(t.pty).toEqual({ cols: 132, rows: 40 })
    expect(t.logs.join('\n')).toContain('resized by another client to 132x40')
  })

  it('does nothing when the pane already has its size', async () => {
    const t = setup()
    const hold = await t.open(40, 20)
    hold.release(true)
    t.native(160, 48)
    await wait(CLOSE_MS)
    expect(t.resizes).toEqual([])
  })

  it('does not resize another terminal that took the pane id', async () => {
    const t = setup()
    const hold = await t.open(40, 20)
    t.replaceTerminal()
    hold.release(true)
    await wait(CLOSE_MS)
    expect(t.resizes).toEqual([])
  })

  it('does nothing for a pane closed meanwhile', async () => {
    const t = setup()
    const hold = await t.open(40, 20)
    t.closePane()
    hold.release(true)
    await wait(CLOSE_MS)
    expect(t.resizes).toEqual([])
    expect(t.sizes.held()).toEqual([])
  })

  it('tries again when the closed session still holds the terminal', async () => {
    const t = setup()
    const hold = await t.open(40, 20)
    t.refuseNext(1)
    hold.release(true)
    await wait(CLOSE_MS)
    expect(t.resizes).toEqual([])
    await wait(1000)
    expect(t.resizes).toEqual(['160x48'])
  })

  it('lets a terminal reopened during the restore wait for it, and keeps the original size', async () => {
    const t = setup()
    const hold = await t.open(40, 20)
    t.refuseNext(1)
    hold.release(true)
    await wait(CLOSE_MS) // first attempt refused, retry pending
    let reopened = false
    const again = t.open(40, 20).then((h) => { reopened = true; return h })
    await wait(0)
    expect(reopened).toBe(false)
    await wait(1000)
    expect(reopened).toBe(true)
    // The retry saw the new terminal and left the pane alone.
    expect(t.resizes).toEqual([])
    ;(await again).release(true)
    await wait(CLOSE_MS)
    expect(t.resizes).toEqual(['160x48'])
  })

  it('without the PTY width, gives back Herdr’s layout width and the rows read', async () => {
    const t = setup({ exact: false, start: { cols: 120, rows: 40 } })
    const hold = await t.open(40, 20)
    hold.release(true)
    await wait(CLOSE_MS)
    expect(t.resizes).toEqual(['120x40'])
  })

  it('without the PTY width, a pane whose rows changed was resized by someone else', async () => {
    const t = setup({ exact: false, start: { cols: 120, rows: 40 } })
    const hold = await t.open(40, 20)
    hold.release(true)
    t.native(100, 29)
    await wait(CLOSE_MS)
    expect(t.resizes).toEqual([])
  })

  it('saves the sizes to give back, and forgets them once given back', async () => {
    const t = setup()
    const hold = await t.open(40, 20)
    expect(t.saved.at(-1)).toEqual({ [PANE]: { cols: 160, rows: 48, exact: true, terminal: 'term_a' } })
    hold.release(true)
    await wait(CLOSE_MS)
    expect(t.saved.at(-1)).toEqual({})
  })

  it('gives back the sizes saved by a wherdr stopped with terminals open', async () => {
    const t = setup({ start: { cols: 40, rows: 20 } })
    t.sizes.adopt({ [PANE]: { cols: 160, rows: 48, exact: true, terminal: 'term_a' } })
    await wait(GRACE_MS)
    expect(t.resizes).toEqual(['160x48'])
    expect(t.sizes.held()).toEqual([])
  })

  it('keeps a saved size for the terminal that reconnects after the restart', async () => {
    const t = setup({ start: { cols: 40, rows: 20 } })
    t.sizes.adopt({ [PANE]: { cols: 160, rows: 48, exact: true, terminal: 'term_a' } })
    const hold = await t.open(40, 20)
    await wait(GRACE_MS * 2)
    expect(t.resizes).toEqual([])
    hold.release(true)
    await wait(CLOSE_MS)
    expect(t.resizes).toEqual(['160x48'])
  })
})

describe('parseSttySize', () => {
  it('reads "rows cols"', () => {
    expect(parseSttySize('29 73\n')).toEqual({ cols: 73, rows: 29 })
  })
  it('refuses anything else', () => {
    expect(parseSttySize('')).toBeNull()
    expect(parseSttySize('stty: stdin isn’t a terminal')).toBeNull()
    expect(parseSttySize('0 0')).toBeNull()
  })
})

describe('cleanSavedSizes', () => {
  const isPane = (id: string) => /^w\d+:p\d+$/.test(id)
  it('keeps valid sizes only', () => {
    expect(cleanSavedSizes({
      'w1:p1': { cols: 160, rows: 48, exact: true, terminal: 'term_a' },
      'w1:p2': { cols: 120, rows: 40 },
      'w1:p3': { cols: 4000, rows: 40, exact: true },
      'w1:p4': { cols: '80', rows: 24 },
      'nope': { cols: 80, rows: 24 },
      'w1:p5': null,
    }, isPane)).toEqual({
      'w1:p1': { cols: 160, rows: 48, exact: true, terminal: 'term_a' },
      'w1:p2': { cols: 120, rows: 40, exact: false },
    })
  })
  it('ignores a damaged file', () => {
    expect(cleanSavedSizes('oops', isPane)).toEqual({})
    expect(cleanSavedSizes(null, isPane)).toEqual({})
  })
})
