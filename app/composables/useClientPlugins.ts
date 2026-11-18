// wherdr plugins: the page-side host (utils/pluginHost.ts) wired to the app.
import { effectScope, watch } from 'vue'
import { readPrefs } from '#shared/clientPlugins'
import type { ClientPluginInfo, PluginPrefs } from '#shared/clientPlugins'
import { createPluginHost, type PluginRow } from '~/utils/pluginHost'
import { syncedRef } from './useSyncedSettings'

const PREFS_KEY = 'wherdr:plugins'
export const clientPlugins = ref<PluginRow[]>([])
// The Community plugins switch (server-wide, shared/clientPlugins.ts). The
// loader starts from the server's answer; a change here or on another device
// reaches the host through this ref.
export const communityPlugins = syncedRef('communityPlugins', raw => raw === '1', v => (v ? '1' : '0'))
let host: ReturnType<typeof createPluginHost> | null = null

const loadPrefs = () => { try { return readPrefs(localStorage.getItem(PREFS_KEY)) } catch { return readPrefs(null) } }
const savePrefs = (p: PluginPrefs) => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)) } catch { /* storage unavailable */ } }

export function startClientPlugins() {
  if (host) return host
  const router = useRouter()
  host = createPluginHost({
    list: () => api<{ plugins: ClientPluginInfo[], enabled: boolean }>('/api/client-plugins'),
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
    onCommunity: (on) => { communityPlugins.value = on },
  })
  const h = host
  // Detached: the first caller can be a component, and this outlives it.
  effectScope(true).run(() => watch(communityPlugins, on => h.setCommunity(on)))
  h.init()
  return h
}
export const setClientPluginEnabled = (id: string, on: boolean) => startClientPlugins().setEnabled(id, on)
