// Hidden agents are remembered rather than an allow list: a newly
// installed agent stays checked by default on each device.
export function readHiddenAgents(raw: string | null): string[] {
  try {
    const value: unknown = JSON.parse(raw || '[]')
    return Array.isArray(value) ? [...new Set(value.filter((kind): kind is string => typeof kind === 'string' && kind !== 'shell'))] : []
  } catch { return [] }
}

export function visibleAgentKinds(installed: readonly string[], hidden: readonly string[]): string[] {
  const excluded = new Set(hidden)
  return [...new Set(installed.filter(kind => kind !== 'shell' && !excluded.has(kind))), 'shell']
}

export function selectedAgentKind(current: string, available: readonly string[], last = ''): string {
  if (available.includes(current)) return current
  if (!current && available.includes(last)) return last
  return available[0] || 'shell'
}

// A task's Start row: its default agent first (as herdr-projects resolves it,
// model included), then the other agents installed on its machine that
// Settings › Agents offers. The default is always shown, even unchecked
// (`hidden`): it is what Start runs. `usable`: the default is installed there;
// unknown (no agent found: the machine could not be checked) it stays usable.
export interface StartAgentChoice { id: string | null, label: string, isDefault: boolean, usable: boolean, hidden: boolean }
export function startAgentChoices(
  o: { agent: { value: string, kind: string } | null, agents: readonly string[] },
  hidden: readonly string[],
  defaultLabel: string,
): StartAgentChoice[] {
  const excluded = new Set(hidden)
  const kind = o.agent?.kind || ''
  const usable = !o.agent || !o.agents.length || o.agents.includes(kind)
  return [
    { id: null, label: o.agent?.value || defaultLabel, isDefault: true, usable, hidden: Boolean(kind) && excluded.has(kind) },
    ...[...new Set(o.agents)].filter(k => k !== kind && !excluded.has(k)).map(k => ({ id: k, label: k, isDefault: false, usable: true, hidden: false })),
  ]
}
