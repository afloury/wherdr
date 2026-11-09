// `wherdr alfred ui open <link>` / `wherdr pm ui open <link>`: an agent asks the
// user's open wherdr to show a place (shared/appLinks.ts) beside its
// conversation. Pure: the link's checks and the event the server sends on
// /ws/events (server/utils/uiOpen.ts; AgentView.vue shows it).
// Opening is all it does: it never changes a setting.
import { isAppLink, SETTINGS_SECTIONS } from './appLinks'
import { PROJECT_TABS, projectPlace as projectSheet, type ProjectTab } from './pm/places'
import type { Turn } from './pm/coordinator'

// The event: the conversation it is for (pane id), the place, who opened it.
export interface UiOpenEvent { type: 'ui-open', pane: string, link: string, by: string }

// `/settings?…` or `#/settings?…`, quoted or not (an unquoted `#` starts a
// shell comment, so the leading `#` may be left out) → `#/settings?…`.
export function uiLink(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim().replace(/^['"]|['"]$/g, '')
  const link = s.startsWith('/') ? `#${s}` : s
  return isAppLink(link) ? link : null
}

// A project coordinator's places: its own board, tasks and sheet, and the
// Settings sections that are not about projects. Everything else (another
// project, every project, Home, Decisions) is Alfred's to open.
function projectPlace(link: string, key: string): boolean {
  const [path, qs = ''] = link.slice(1).split('?')
  const q = new URLSearchParams(qs)
  if (path === '/board') {
    const task = q.get('task')
    if (task) return task.toUpperCase().startsWith(`${key}-`)
    return q.get('project')?.toUpperCase() === key
  }
  if (path !== '/settings') return false
  const section = q.get('section') ?? ''
  if (section === 'projects') return q.get('project')?.toUpperCase() === key
  return section === 'pacing' || (SETTINGS_SECTIONS as readonly string[]).includes(section)
}

// Why the open is refused, or null. scope: MAIN (Alfred, any place) or the
// coordinator's project key.
export function uiOpenRefusal(link: string | null, turn: Turn, scope: string, main: boolean): string | null {
  if (!link) return 'Not an in-app link: give one of the addresses of your links list, quoted (\'#/settings?section=phone\')'
  if (turn !== 'user') return 'ui open is only for a turn that comes from the user, never in a wake'
  if (!main && !projectPlace(link, scope)) return `Your token opens project ${scope}'s places and the global settings only`
  return null
}

// What the card names: "Settings › Phone", "Task WHR-12", "Board › WHR".
export function uiPlaceLabel(link: string): string {
  const [path, qs = ''] = link.slice(1).split('?')
  const q = new URLSearchParams(qs)
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).replace(/-/g, ' ')
  if (path === '/settings') {
    const section = q.get('section') ?? '', project = q.get('project'), tab = q.get('tab') ?? ''
    if (section === 'projects') return projectSheet(project ?? undefined, (PROJECT_TABS as readonly string[]).includes(tab) ? tab as ProjectTab : 'general')
    if (section === 'pacing') return 'Settings › Agents › Pace'
    return section ? `Settings › ${cap(section)}${section === 'conversation' && tab ? ` › ${cap(tab)}` : ''}` : 'Settings'
  }
  if (path === '/board') {
    const task = q.get('task'), project = q.get('project'), tag = q.get('tag')
    return task ? `Task ${task}` : project ? `Board › ${project}` : tag ? `Board › ${tag}` : 'Board'
  }
  return path === '/decisions' ? 'Decisions' : path === '/' || !path ? 'Home' : path.slice(1)
}
