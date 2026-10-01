import type { HerdrState, MachineInfo } from '../../shared/types'

export function readSessionSelection(raw: string | null): Record<string, string> {
  let value: unknown
  try { value = JSON.parse(raw || '{}') } catch { return {} }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const names: Record<string, string> = {}
  for (const [key, name] of Object.entries(value)) {
    if ((key === '' || /^[0-9a-f]{4,32}$/.test(key)) && typeof name === 'string' && /^[\w.-]{1,64}$/.test(name)) names[key] = name
  }
  return names
}

export const writeSessionSelection = (names: Record<string, string>) => JSON.stringify(names)

// The server follows all open sessions; each device only shows
// the session chosen for each physical machine.
export function selectSessions(state: HerdrState, names: Record<string, string>): HerdrState {
  if (!state.machines) return state
  const selected: MachineInfo[] = []
  for (const base of state.machines.filter(m => m.baseKey === undefined)) {
    const name = names[base.key]
    selected.push(state.machines.find(m => m.baseKey === base.key && m.session === name) || base)
  }
  const keys = new Set(selected.map(m => m.key))
  const local = selected.find(m => m.local)
  return {
    ...state,
    ok: local ? local.status === 'online' && (local.baseKey !== undefined || state.ok) : state.ok,
    version: local?.version || state.version,
    session: local?.session || state.session,
    machines: selected,
    workspaces: state.workspaces.filter(w => keys.has(w.machine || '')),
    tabs: state.tabs?.filter(t => keys.has(t.machine || '')),
    panes: state.panes.filter(p => keys.has(p.machine || '')),
  }
}
