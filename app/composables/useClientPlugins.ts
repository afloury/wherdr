// wherdr plugins: the page-side host (utils/pluginHost.ts) wired to the app.
import { readPrefs } from '#shared/clientPlugins'
import type { ClientPluginInfo, PluginPrefs } from '#shared/clientPlugins'
import { createPluginHost, type PluginAgent, type PluginRow, type StartedAgent } from '~/utils/pluginHost'
import type { Pane } from '#shared/types'

const PREFS_KEY = 'wherdr:plugins'
export const clientPlugins = ref<PluginRow[]>([])
let host: ReturnType<typeof createPluginHost> | null = null

const loadPrefs = () => { try { return readPrefs(localStorage.getItem(PREFS_KEY)) } catch { return readPrefs(null) } }
const savePrefs = (p: PluginPrefs) => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)) } catch { /* storage unavailable */ } }

// The agents list of the plugin API (wherdr.state): a stable, plain copy of the panes.
export const pluginAgent = (p: Pane): PluginAgent => ({
  id: p.id, name: p.label || p.name || null, agent: p.agent, status: p.status, labels: { ...p.labels }, folder: p.cwd || null, machine: p.machine || '',
})

export function startClientPlugins() {
  if (host) return host
  const router = useRouter()
  host = createPluginHost({
    list: async () => (await api<{ plugins: ClientPluginInfo[] }>('/api/client-plugins')).plugins,
    load: info => import(/* @vite-ignore */ `${location.origin}/api/client-plugins/${encodeURIComponent(info.id)}/${encodeURIComponent(info.main)}`),
    insertDraft: (text) => {
      if (!curPane.value) return
      const d = useDraft(curPane.value)
      d.text = d.text && !/\s$/.test(d.text) ? `${d.text} ${text}` : d.text + text
    },
    currentAgent: () => {
      const p = herdrState.value.panes.find(x => x.id === curPane.value)
      return p ? { id: p.id, agent: p.agent, name: p.name || p.label || null, machine: p.machine || null } : null
    },
    subscribeNavigate: cb => router.afterEach(to => cb(to.fullPath)),
    agents: () => herdrState.value.panes.map(pluginAgent),
    // A cheap key of what plugins see: the host only calls back when the list changed.
    subscribeAgents: cb => watch(() => herdrState.value.panes.map(p => `${p.id}\t${p.status}\t${p.cwd}\t${p.label}\t${JSON.stringify(p.labels ?? {})}`).join('\n'), () => cb()),
    startAgent: async (o) => {
      const r = await api<{ pane_id: string, name: string | null, first_message: StartedAgent['firstMessage'] }>('/api/agents', {
        kind: o.agent, machine: o.machine, cwd: o.folder, name: o.name, prompt: o.firstMessage, labels: o.labels,
      })
      return { id: r.pane_id, name: r.name, firstMessage: r.first_message ?? null }
    },
    openAgent: id => { navigateTo(panePath(id)) },
    readFile: async (machine, path) => (await api<{ text: string | null }>('/api/plugin-files/read', { machine, path })).text,
    writeFile: async (machine, path, text) => { await api('/api/plugin-files/write', { machine, path, text }) },
    prefs: loadPrefs,
    savePrefs,
    changed: () => { clientPlugins.value = host!.rows() },
  })
  host.init()
  return host
}
export const setClientPluginEnabled = (id: string, on: boolean) => startClientPlugins().setEnabled(id, on)
