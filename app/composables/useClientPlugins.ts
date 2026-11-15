// wherdr plugins: the page-side host (utils/pluginHost.ts) wired to the app.
import { readPrefs } from '#shared/clientPlugins'
import type { ClientPluginInfo, PluginPrefs } from '#shared/clientPlugins'
import { createPluginHost, type PluginRow } from '~/utils/pluginHost'

const PREFS_KEY = 'wherdr:plugins'
export const clientPlugins = ref<PluginRow[]>([])
let host: ReturnType<typeof createPluginHost> | null = null

const loadPrefs = () => { try { return readPrefs(localStorage.getItem(PREFS_KEY)) } catch { return readPrefs(null) } }
const savePrefs = (p: PluginPrefs) => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)) } catch { /* storage unavailable */ } }

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
    prefs: loadPrefs,
    savePrefs,
    changed: () => { clientPlugins.value = host!.rows() },
  })
  host.init()
  return host
}
export const setClientPluginEnabled = (id: string, on: boolean) => startClientPlugins().setEnabled(id, on)
