// `show --json -- <id>` rows, as returned by herdr-projects. Keep values
// typed and provenance verbatim; missing data never becomes a CLI default.
export interface TaskSetting {
  name: string
  kind: string
  value: unknown
  from: string
  place: string
  own: boolean | null
  note: string
  later?: string
}
export interface TaskSettings { settings: TaskSetting[], problems: string[] }
export function parseTaskSettings(raw: string): TaskSettings {
  const data = JSON.parse(raw)
  if (!data || !Array.isArray(data.settings) || (data.problems !== undefined && !Array.isArray(data.problems))) throw new Error('Invalid task settings response')
  return {
    settings: data.settings.map((row: unknown) => {
      if (!row || typeof row !== 'object' || !('name' in row) || typeof row.name !== 'string') throw new Error('Invalid task settings response')
      const r = row as Record<string, unknown>
      const text = (key: string) => typeof r[key] === 'string' ? r[key] as string : ''
      return { name: row.name, kind: text('kind'), value: r.value ?? null, from: text('from'), place: text('place'), own: typeof r.own === 'boolean' ? r.own : null, note: text('note'), ...(text('later') ? { later: text('later') } : {}) }
    }),
    problems: (data.problems ?? []).map((p: unknown) => typeof p === 'string' ? p : JSON.stringify(p)),
  }
}
export const settingGroups = ['agent', 'review', 'plan', 'limits', 'merge', 'workspace', 'other'] as const
export type SettingGroup = typeof settingGroups[number]
export function settingGroup(name: string): SettingGroup {
  if (/^worker\.|^(research|chat)\.only$/.test(name)) return 'agent'
  if (/^(reviewer|review)\./.test(name)) return 'review'
  if (/^(plan|attempts|check)\./.test(name)) return 'plan'
  if (name.startsWith('limit.')) return 'limits'
  if (name.startsWith('merge.')) return 'merge'
  if (name.startsWith('workspace.')) return 'workspace'
  return 'other'
}
export function settingValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}
