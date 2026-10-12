// Labels of a herdr-projects thread, as the Project panel and the Board show it.
// In app/, not shared/: the texts go through t() / tl() / fmtWhen.
import type { ProjectThread } from '#shared/projectBoard'

const GROUPS: Record<string, [string, string]> = {
  'waiting-on-you': ['blocked', t('Your turn')],
  'ready-for-review': ['done', t('Ready for review')],
  'landing': ['working', t('Landing')],
  'working': ['working', t('Working')],
  'idle': ['idle', t('Idle')],
  'resolved': ['inactive', tl('Done', 'Fait')],
}

// Status class: blocked, done, working, idle, inactive (resolved: neutral gray) or unknown.
export const threadClass = (th: Pick<ProjectThread, 'token'>) => GROUPS[th.token]?.[0] || 'unknown'
export const threadLabel = (th: Pick<ProjectThread, 'token' | 'group'>) => GROUPS[th.token]?.[1] || th.group || t('Unknown')

export function threadMeta(th: ProjectThread) {
  const bits = [th.id.toUpperCase()]
  if (th.machine) bits.push(th.machine)
  if (th.percent !== null && !th.resolved) bits.push(`${th.percent} %`)
  if (th.activity && !th.resolved) bits.push(th.activity)
  const when = th.updated && fmtWhen(th.updated)
  if (when) bits.push(when)
  return bits.join(' · ')
}
