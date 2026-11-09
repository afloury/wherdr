// `wherdr alfred ui open <link>` / `wherdr pm ui open <link>`: an agent asks the
// user's open wherdr to show a place (shared/appLinks.ts) beside its
// conversation. Pure: the link's checks and the event the server sends on
// /ws/events (server/utils/uiOpen.ts; AgentView.vue shows it).
// Opening is all it does: it never changes a setting.
import { isAppLink, SETTINGS_SECTIONS } from './appLinks'
import { PROJECT_TABS, projectPlace as projectSheet, type ProjectTab } from './pm/places'
import type { Turn } from './pm/coordinator'
import { projectOf, shownKey, storedTaskId } from './pm/projectKey'
import type { Project } from './pm/project'

// The coordinator's project: its fixed key, the key it shows, its former keys.
export type OwnProject = Pick<Project, 'key'> & { label?: string, aliases?: string[] }

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
// project, every project, Home, Decisions) is Alfred's to open. A link may
// name the project by any of its keys (a renamed project shows CMP for CP).
function projectPlace(link: string, own: OwnProject): boolean {
  const ours = (k: string | null) => !!projectOf([own], k)
  const [path, qs = ''] = link.slice(1).split('?')
  const q = new URLSearchParams(qs)
  if (path === '/board') {
    const task = q.get('task')
    if (task) return storedTaskId([own], task) !== null
    return ours(q.get('project'))
  }
  if (path !== '/settings') return false
  const section = q.get('section') ?? ''
  if (section === 'projects') return ours(q.get('project'))
  return section === 'pacing' || (SETTINGS_SECTIONS as readonly string[]).includes(section)
}

// Why the open is refused, or null. own: the coordinator's project; Alfred
// (main) opens any place.
export function uiOpenRefusal(link: string | null, turn: Turn, own: OwnProject, main: boolean): string | null {
  if (!link) return 'Not an in-app link: give one of the addresses of your links list, quoted (\'#/settings?section=phone\')'
  if (turn !== 'user') return 'ui open is only for a turn that comes from the user, never in a wake'
  if (!main && !projectPlace(link, own)) return `Your token opens project ${shownKey(own)}'s places and the global settings only`
  return null
}

// What the card names: "Settings › Phone", "Task WHR-12", "Board › WHR › ui".
// A chat's in-app link shows it too, after "Open" (utils/markdown.ts).
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
    return task ? `Task ${task}` : ['Board', project, tag].filter(Boolean).join(' › ')
  }
  return path === '/decisions' ? 'Decisions' : path === '/' || !path ? 'Home' : path.slice(1)
}
