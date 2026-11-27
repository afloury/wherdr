// wherdr plugin host: loads prebuilt ESM plugins, hands each one a `wherdr`
// object and isolates their failures (a plugin that throws is disabled, the
// app keeps working). Framework-free: the page supplies what it touches.
import type { ClientPluginInfo, PluginPrefs } from '../../shared/clientPlugins'

export interface CurrentAgent { id: string, agent: string | null, name: string | null, machine: string | null }
export interface WherdrApi {
  apiVersion: 1
  draft: {
    get: () => string | null
    set: (text: string) => void
    insert: (text: string) => void
    focus: () => void
  }
  currentAgent: () => CurrentAgent | null
  // Returns the unsubscribe function.
  onNavigate: (cb: (path: string) => void) => () => void
}
type Plugin = ((w: WherdrApi) => unknown) | { activate: (w: WherdrApi) => unknown, deactivate?: () => unknown }

export interface HostDeps {
  // The installed plugins and the Community plugins switch (off: none loads).
  list: () => Promise<{ plugins: ClientPluginInfo[], enabled: boolean }>
  load: (info: ClientPluginInfo) => Promise<{ default?: unknown }>
  // The open conversation's draft: null when no conversation is open, writes no-op then.
  getDraft: () => string | null
  setDraft: (text: string) => void
  insertDraft: (text: string) => void
  focusDraft: () => void
  currentAgent: () => CurrentAgent | null
  // Subscribes to route changes; returns the unsubscribe function.
  subscribeNavigate: (cb: (path: string) => void) => () => void
  prefs: () => PluginPrefs
  savePrefs: (p: PluginPrefs) => void
  // Called when anything about a plugin's state changed (the Settings list).
  changed: () => void
  // The switch as the server gave it, before any plugin starts.
  onCommunity?: (on: boolean) => void
  timeoutMs?: number
}

export type PluginStatus = 'running' | 'off' | 'failed' | 'loading'
// `wanted`: the plugin's own switch, kept while Community plugins is off.
export interface PluginRow extends ClientPluginInfo { status: PluginStatus, error: string, wanted: boolean }

const msg = (e: unknown) => String((e as Error)?.message || e).slice(0, 300)

export function createPluginHost(deps: HostDeps) {
  const infos: ClientPluginInfo[] = []
  const status = new Map<string, PluginStatus>()
  const subs = new Map<string, Set<() => void>>()
  const instances = new Map<string, Plugin>()
  let listError = ''
  let community = false
  // One number per plugin, raised when it is turned off: a load still pending
  // from before is dropped instead of activating. Its top-level code already
  // ran at import() and cannot be undone; only activate() is skipped (plugins
  // keep their side effects in activate, docs/plugins.md).
  const runs = new Map<string, number>()
  const cancel = (id: string) => {
    const next = (runs.get(id) ?? 0) + 1
    runs.set(id, next)
    return next
  }

  function fail(id: string, e: unknown) {
    const p = deps.prefs()
    deps.savePrefs({ off: p.off, failed: { ...p.failed, [id]: msg(e) } })
    stop(id)
    status.set(id, 'failed')
    deps.changed()
  }

  // The `wherdr` object of one plugin, scoped to one activation run: every
  // registration is tracked and its callback guarded, so that the host can
  // undo everything the plugin registered when it stops for any reason,
  // whether deactivate() exists or not, and a throw or a rejected promise in
  // a host-invoked callback disables that plugin only.
  function apiFor(id: string, run: number): WherdrApi {
    const own = new Set<() => void>()
    subs.set(id, own)
    const isCurrent = () => subs.get(id) === own && runs.get(id) === run
    // A registration's disposer: idempotent, and the registration is disposed
    // at once when the plugin it belongs to is already stopped.
    const track = (dispose: () => void): (() => void) => {
      if (!isCurrent()) {
        try { dispose() } catch { /* a failing teardown changes nothing */ }
        return () => {}
      }
      let done = false
      const wrap = () => {
        if (done) return
        done = true
        own.delete(wrap)
        try { dispose() } catch { /* a failing teardown changes nothing */ }
      }
      own.add(wrap)
      return wrap
    }
    // A host-invoked callback: skipped once the run is stale, a throw or a
    // rejection disables the plugin (which disposes its registrations).
    const guard = (fn: () => unknown) => {
      if (!isCurrent()) return
      try {
        const res = fn()
        if (res && typeof (res as PromiseLike<unknown>).then === 'function') {
          Promise.resolve(res).catch((e) => { if (isCurrent()) fail(id, e) })
        }
      } catch (e) {
        if (isCurrent()) fail(id, e)
      }
    }
    return {
      apiVersion: 1,
      draft: {
        get: () => deps.getDraft(),
        set: (text) => { if (typeof text === 'string') deps.setDraft(text) },
        insert: (text) => { if (typeof text === 'string' && text) deps.insertDraft(text) },
        focus: () => { deps.focusDraft() },
      },
      currentAgent: () => deps.currentAgent(),
      onNavigate: (cb) => {
        if (typeof cb !== 'function') throw new TypeError('onNavigate expects a function')
        if (!isCurrent()) return () => {}
        const off = deps.subscribeNavigate((path) => {
          if (!isCurrent() || status.get(id) !== 'running') return
          guard(() => cb(path))
        })
        return track(off)
      },
    }
  }

  function stop(id: string) {
    cancel(id)
    const own = subs.get(id)
    subs.delete(id)
    if (own) {
      for (const off of [...own]) {
        try { off() } catch { /* a failing teardown changes nothing */ }
      }
    }
    const inst = instances.get(id)
    instances.delete(id)
    if (inst && typeof inst === 'object' && typeof inst.deactivate === 'function') {
      try { Promise.resolve(inst.deactivate()).catch(() => {}) } catch { /* a failing teardown changes nothing */ }
    }
  }

  async function start(info: ClientPluginInfo) {
    status.set(info.id, 'loading')
    deps.changed()
    const run = cancel(info.id)
    // Still wanted: not turned off (or off and on again) since this load began.
    const live = () => community && runs.get(info.id) === run
    try {
      const mod = await withTimeout(deps.load(info), deps.timeoutMs ?? 8000, 'Loading timed out')
      if (!live()) return
      const plugin = mod.default as Plugin
      const fn = typeof plugin === 'function' ? plugin : plugin && typeof plugin.activate === 'function' ? plugin.activate.bind(plugin) : null
      if (!fn) throw new Error('The bundle has no default export (a function or { activate })')
      if (typeof plugin === 'object') instances.set(info.id, plugin)
      await withTimeout(Promise.resolve(fn(apiFor(info.id, run))), deps.timeoutMs ?? 8000, 'Activation timed out')
      // Stale (turned off, failed or started again while it activated): stop()
      // already undid its registrations, and any late one disposes itself.
      if (!live()) return
      status.set(info.id, 'running')
      deps.changed()
    } catch (e) { if (live()) fail(info.id, e) }
  }

  // The plugins to start: wanted, not failed, not already started.
  function startAll() {
    const p = deps.prefs()
    for (const info of infos) {
      if (p.off.includes(info.id)) status.set(info.id, 'off')
      else if (p.failed[info.id]) status.set(info.id, 'failed')
    }
    deps.changed()
    // A plugin's failure never reaches the others or the app.
    return Promise.all(infos.filter(i => !status.has(i.id)).map(start))
  }

  async function init() {
    try {
      const res = await deps.list()
      infos.splice(0, infos.length, ...res.plugins)
      community = res.enabled
    } catch (e) { listError = msg(e); deps.changed(); return }
    deps.onCommunity?.(community)
    if (community) await startAll()
    else deps.changed()
  }

  // The plugins folder changed (installed, updated or removed from Settings):
  // a plugin gone or at another commit is stopped, then the wanted ones start.
  async function refresh() {
    const res = await deps.list()
    const before = new Map(infos.map(i => [i.id, i.source?.commit]))
    infos.splice(0, infos.length, ...res.plugins)
    const p = deps.prefs()
    const failed = { ...p.failed }
    for (const [id, commit] of before) {
      const now = infos.find(i => i.id === id)
      if (!now || now.source?.commit !== commit) { cancel(id); stop(id); status.delete(id); delete failed[id] }
    }
    // A failure belongs to the code that failed: another commit gets a new try.
    if (Object.keys(failed).length !== Object.keys(p.failed).length) deps.savePrefs({ off: p.off, failed })
    if (community) await startAll()
    else deps.changed()
  }

  // Community plugins turned on or off (here or on another device).
  async function setCommunity(on: boolean) {
    if (on === community) return
    community = on
    if (on) return startAll()
    for (const id of [...status.keys()]) {
      cancel(id)
      stop(id)
      if (status.get(id) !== 'failed') status.delete(id)
    }
    deps.changed()
  }

  // Turning on also clears an earlier failure (the person retries).
  async function setEnabled(id: string, on: boolean) {
    const info = infos.find(i => i.id === id)
    if (!info || !community) return
    const p = deps.prefs()
    const failed = { ...p.failed }
    delete failed[id]
    deps.savePrefs({ off: on ? p.off.filter(x => x !== id) : [...new Set([...p.off, id])], failed })
    if (on) await start(info)
    else { cancel(id); stop(id); status.set(id, 'off'); deps.changed() }
  }

  function rows(): PluginRow[] {
    const p = deps.prefs()
    return infos.map(i => ({ ...i, status: status.get(i.id) || 'off', error: p.failed[i.id] || '', wanted: !p.off.includes(i.id) }))
  }
  return { init, refresh, setEnabled, setCommunity, rows, listError: () => listError }
}

function withTimeout<T>(p: Promise<T>, ms: number, why: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>
  return Promise.race([p, new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error(why)), ms) })]).finally(() => clearTimeout(t))
}
