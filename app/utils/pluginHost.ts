// wherdr plugin host: loads prebuilt ESM plugins, hands each one a `wherdr`
// object and isolates their failures (a plugin that throws is disabled, the
// app keeps working). Framework-free: the page supplies what it touches.
import type { ClientPluginInfo, PluginPrefs } from '../../shared/clientPlugins'

export interface CurrentAgent { id: string, agent: string | null, name: string | null, machine: string | null }
export interface WherdrApi {
  apiVersion: 1
  draft: { insert: (text: string) => void }
  currentAgent: () => CurrentAgent | null
  // Returns the unsubscribe function.
  onNavigate: (cb: (path: string) => void) => () => void
}
type Plugin = ((w: WherdrApi) => unknown) | { activate: (w: WherdrApi) => unknown, deactivate?: () => unknown }

export interface HostDeps {
  list: () => Promise<ClientPluginInfo[]>
  load: (info: ClientPluginInfo) => Promise<{ default?: unknown }>
  insertDraft: (text: string) => void
  currentAgent: () => CurrentAgent | null
  // Subscribes to route changes; returns the unsubscribe function.
  subscribeNavigate: (cb: (path: string) => void) => () => void
  prefs: () => PluginPrefs
  savePrefs: (p: PluginPrefs) => void
  // Called when anything about a plugin's state changed (the Settings list).
  changed: () => void
  timeoutMs?: number
}

export type PluginStatus = 'running' | 'off' | 'failed' | 'loading'
export interface PluginRow extends ClientPluginInfo { status: PluginStatus, error: string }

const msg = (e: unknown) => String((e as Error)?.message || e).slice(0, 300)

export function createPluginHost(deps: HostDeps) {
  const infos: ClientPluginInfo[] = []
  const status = new Map<string, PluginStatus>()
  const subs = new Map<string, Set<() => void>>()
  const instances = new Map<string, Plugin>()
  let listError = ''

  function fail(id: string, e: unknown) {
    const p = deps.prefs()
    deps.savePrefs({ off: p.off, failed: { ...p.failed, [id]: msg(e) } })
    stop(id)
    status.set(id, 'failed')
    deps.changed()
  }

  // The `wherdr` object of one plugin: callbacks are guarded, a throw disables it.
  function apiFor(id: string): WherdrApi {
    const own = new Set<() => void>()
    subs.set(id, own)
    return {
      apiVersion: 1,
      draft: { insert: (text) => { if (typeof text === 'string' && text) deps.insertDraft(text) } },
      currentAgent: () => deps.currentAgent(),
      onNavigate: (cb) => {
        const off = deps.subscribeNavigate((path) => {
          if (status.get(id) !== 'running') return
          try { Promise.resolve(cb(path)).catch(e => fail(id, e)) } catch (e) { fail(id, e) }
        })
        own.add(off)
        return () => { off(); own.delete(off) }
      },
    }
  }

  function stop(id: string) {
    for (const off of subs.get(id) || []) off()
    subs.delete(id)
    const inst = instances.get(id)
    instances.delete(id)
    if (inst && typeof inst === 'object' && typeof inst.deactivate === 'function') {
      try { Promise.resolve(inst.deactivate()).catch(() => {}) } catch { /* a failing teardown changes nothing */ }
    }
  }

  async function start(info: ClientPluginInfo) {
    status.set(info.id, 'loading')
    deps.changed()
    try {
      const mod = await withTimeout(deps.load(info), deps.timeoutMs ?? 8000, 'Loading timed out')
      const plugin = mod.default as Plugin
      const fn = typeof plugin === 'function' ? plugin : plugin && typeof plugin.activate === 'function' ? plugin.activate.bind(plugin) : null
      if (!fn) throw new Error('The bundle has no default export (a function or { activate })')
      if (typeof plugin === 'object') instances.set(info.id, plugin)
      await withTimeout(Promise.resolve(fn(apiFor(info.id))), deps.timeoutMs ?? 8000, 'Activation timed out')
      status.set(info.id, 'running')
      deps.changed()
    } catch (e) { fail(info.id, e) }
  }

  async function init() {
    try { infos.splice(0, infos.length, ...await deps.list()) } catch (e) { listError = msg(e); deps.changed(); return }
    const p = deps.prefs()
    for (const info of infos) {
      if (p.off.includes(info.id)) status.set(info.id, 'off')
      else if (p.failed[info.id]) status.set(info.id, 'failed')
    }
    deps.changed()
    // A plugin's failure never reaches the others or the app.
    await Promise.all(infos.filter(i => !status.has(i.id)).map(start))
  }

  // Turning on also clears an earlier failure (the person retries).
  async function setEnabled(id: string, on: boolean) {
    const info = infos.find(i => i.id === id)
    if (!info) return
    const p = deps.prefs()
    const failed = { ...p.failed }
    delete failed[id]
    deps.savePrefs({ off: on ? p.off.filter(x => x !== id) : [...new Set([...p.off, id])], failed })
    if (on) await start(info)
    else { stop(id); status.set(id, 'off'); deps.changed() }
  }

  function rows(): PluginRow[] {
    const p = deps.prefs()
    return infos.map(i => ({ ...i, status: status.get(i.id) || 'off', error: p.failed[i.id] || '' }))
  }
  return { init, setEnabled, rows, listError: () => listError }
}

function withTimeout<T>(p: Promise<T>, ms: number, why: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>
  return Promise.race([p, new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error(why)), ms) })]).finally(() => clearTimeout(t))
}
