// Size of the panes whose terminal wherdr opens. A control session resizes
// the real PTY (to the phone's ~40 columns), and Herdr keeps that size once the
// session is released unless one of its own clients is attached to lay the
// pane out again (typical of a machine driven from afar): the agents' screens
// stay cut. So the size is remembered when the first terminal of a pane opens
// and given back when the last one closes.
//
// No I/O here: reading and resizing are injected (see terminal.ts).

export interface PaneSize {
  cols: number
  rows: number
  // false: `cols` comes from Herdr's layout, not from the PTY (see readPaneSize).
  exact: boolean
  // Herdr's terminal id: a pane id may be reused by another terminal.
  terminal?: string
}

export interface PaneSizesDeps {
  read: (pane: string) => Promise<PaneSize | null>
  resize: (pane: string, cols: number, rows: number) => Promise<boolean>
  // Delay before giving the size back: after a terminal closed on purpose
  // (the control session must be gone, and a view reopened at once keeps its
  // size), and after a connection that dropped (locked phone, lost network:
  // it usually comes back).
  closeMs: number
  graceMs: number
  // A refused resize (the closed session still attached) is tried once more.
  retryMs?: number
  // Sizes still to give back, saved so a restart of wherdr does not lose them.
  save?: (sizes: Record<string, PaneSize>) => void
  log?: (message: string) => void
}

// One open terminal of a pane (or the mirror of a pane wherdr resized).
export interface PaneHold {
  // The size this terminal asked for.
  resized: (cols: number, rows: number) => void
  // `clean`: closed on purpose, as opposed to a connection that dropped.
  release: (clean: boolean) => void
}

interface Entry {
  original: PaneSize | null
  ready: Promise<void>
  clients: number
  // Last size asked by wherdr: another size on the pane means that someone
  // else (a Herdr client) resized it since.
  set: { cols: number, rows: number } | null
  timer?: ReturnType<typeof setTimeout>
  restoring: Promise<void> | null
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

export function createPaneSizes(deps: PaneSizesDeps) {
  const entries = new Map<string, Entry>()
  const log = deps.log || (() => {})

  function save() {
    if (!deps.save) return
    const out: Record<string, PaneSize> = {}
    for (const [pane, e] of entries) if (e.original) out[pane] = e.original
    deps.save(out)
  }

  function drop(pane: string, e: Entry) {
    if (entries.get(pane) !== e) return
    entries.delete(pane)
    save()
  }

  // Why the pane keeps its current size (null: it gets its original one back).
  function keepReason(e: Entry, now: PaneSize | null): string | null {
    const o = e.original!
    if (!now) return 'pane gone'
    if (o.terminal && now.terminal && o.terminal !== now.terminal) return 'another terminal'
    if (now.rows === o.rows && now.cols === o.cols) return 'already at its size'
    const set = e.set
    if (set && (now.rows !== set.rows || (now.exact && now.cols !== set.cols))) return `resized by another client to ${now.cols}x${now.rows}`
    return null
  }

  async function restore(pane: string, e: Entry) {
    const o = e.original!
    const why = keepReason(e, await deps.read(pane).catch(() => null))
    if (why) return log(`term ${pane} size kept (${why})`)
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) await sleep(deps.retryMs ?? 1500)
      // A terminal opened again meanwhile: it sets its own size.
      if (e.clients > 0) return
      if (await deps.resize(pane, o.cols, o.rows).catch(() => false)) return
    }
    log(`term ${pane} could not get its ${o.cols}x${o.rows} back`)
  }

  function schedule(pane: string, e: Entry, ms: number) {
    clearTimeout(e.timer)
    e.timer = setTimeout(() => {
      e.timer = undefined
      e.restoring = restore(pane, e).catch(() => {}).finally(() => {
        e.restoring = null
        if (e.clients === 0 && !e.timer) drop(pane, e)
      })
    }, ms)
  }

  // To call BEFORE the control session is started (it resizes the pane):
  // resolves once the pane's size is known, and a pending restore done.
  async function hold(pane: string): Promise<PaneHold> {
    let e = entries.get(pane)
    if (e) {
      clearTimeout(e.timer)
      e.timer = undefined
      e.clients++
    } else {
      const fresh: Entry = { original: null, ready: Promise.resolve(), clients: 1, set: null, restoring: null }
      fresh.ready = deps.read(pane).catch(() => null).then((size) => {
        fresh.original = size
        if (size) save()
      })
      entries.set(pane, fresh)
      e = fresh
    }
    const entry = e
    await entry.ready
    if (entry.restoring) await entry.restoring
    let released = false
    return {
      resized(cols, rows) {
        if (!released) entry.set = { cols, rows }
      },
      release(clean) {
        if (released) return
        released = true
        if (--entry.clients > 0) return
        if (!entry.original) return drop(pane, entry)
        schedule(pane, entry, clean ? deps.closeMs : deps.graceMs)
      },
    }
  }

  // Sizes saved by a previous run of wherdr, stopped while terminals were
  // open: given back after the grace delay, unless their terminal reconnects.
  function adopt(sizes: Record<string, PaneSize>) {
    for (const [pane, size] of Object.entries(sizes)) {
      if (entries.has(pane)) continue
      const e: Entry = { original: size, ready: Promise.resolve(), clients: 0, set: null, restoring: null }
      entries.set(pane, e)
      schedule(pane, e, deps.graceMs)
    }
  }

  function stop() {
    for (const e of entries.values()) clearTimeout(e.timer)
  }

  // Size wherdr last gave the pane, while one of its views holds it.
  const asked = (pane: string) => entries.get(pane)?.set ?? null

  return { hold, adopt, stop, asked, held: () => [...entries.keys()] }
}

// "rows cols" of `stty size`.
export function parseSttySize(out: string): { cols: number, rows: number } | null {
  const m = /^\s*(\d{1,4})\s+(\d{1,4})\s*$/.exec(out)
  if (!m) return null
  const rows = Number(m[1])
  const cols = Number(m[2])
  return rows > 0 && cols > 0 ? { cols, rows } : null
}

// Saved sizes, as read back from disk (anything else is ignored).
export function cleanSavedSizes(raw: unknown, isPane: (id: string) => boolean): Record<string, PaneSize> {
  const out: Record<string, PaneSize> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [pane, v] of Object.entries(raw as Record<string, unknown>)) {
    const s = v as Partial<PaneSize> | null
    if (!isPane(pane) || !s || !Number.isInteger(s.cols) || !Number.isInteger(s.rows)) continue
    if (s.cols! < 10 || s.cols! > 400 || s.rows! < 5 || s.rows! > 200) continue
    out[pane] = { cols: s.cols!, rows: s.rows!, exact: s.exact === true, ...(typeof s.terminal === 'string' ? { terminal: s.terminal } : {}) }
  }
  return out
}
