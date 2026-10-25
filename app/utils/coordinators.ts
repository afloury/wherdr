import type { CoordinatorTarget, MachineTasks } from '../../shared/projectsTasks'
import type { CoordinatorLevel } from '../../shared/boardLinks'
import { tl } from './i18n'

// One name per coordinator, as herdr-projects names them: "Coordinator",
// "<machine> coordinator", "<repo> coordinator". The Board, the home list,
// the panel heading and the menus all say it this way.
export function coordinatorLabel(to: CoordinatorTarget, machine: string): string {
  if (to.kind === 'project') return tl(`${to.repo} coordinator`, `Coordinateur · ${to.repo}`)
  if (to.kind === 'machine') return machine ? tl(`${machine} coordinator`, `Coordinateur · ${machine}`) : tl('Machine coordinator', 'Coordinateur de la machine')
  return tl('Coordinator', 'Coordinateur')
}

export function coordinatorDescription(to: CoordinatorTarget): string {
  if (to.kind === 'machine') return tl('This machine as a whole: its repos and folders, its tasks and agents.', 'Cette machine dans son ensemble : ses dépôts et dossiers, ses tâches et ses agents.')
  if (to.kind === 'project') return tl('Plan and follow work in this repo.', 'Organiser et suivre le travail dans ce dépôt.')
  return tl('All work: every repo and machine it can reach.', 'Tout le travail : tous les dépôts et machines qu’il peut joindre.')
}

// Keep unavailable boards in the picker; never silently redirect to another host.
export function coordinatorUnavailable(m: MachineTasks, offline = false): string {
  if (offline) return tl('Offline: reconnect to open a Coordinator.', 'Hors ligne : reconnecte-toi pour ouvrir un Coordinateur.')
  if (m.status === 'error' || m.error || m.stale) return m.error || tl('Machine cannot be reached now.', 'Machine injoignable pour l’instant.')
  if (m.status === 'missing') return tl('herdr-projects is not installed.', 'herdr-projects n’est pas installé.')
  if (m.status === 'old') return tl('Update herdr-projects to use its Coordinators.', 'Mets herdr-projects à jour pour utiliser ses Coordinateurs.')
  if (m.status === 'disabled') return tl('herdr-projects is disabled.', 'herdr-projects est désactivé.')
  return ''
}

// How the home list shows each kind of herdr-projects coordinator (it has
// three: the board's Coordinator, the machine coordinator and one per repo).
// Each has its own icon, and the same name as on the Board (coordinatorLabel):
//  - `top`: the board's Coordinator (all work): the board's icon;
//  - `machine`: the machine coordinator: the machine's own icon, as on its heading;
//  - `project`: drawn by ProjectGroup (the wherdr mark and "Coordinator").
export interface CoordinatorKind { icon: string, name: string, hint: string }
export function coordinatorKind(level: CoordinatorLevel, local = true, machine = '', repo = ''): CoordinatorKind {
  const to: CoordinatorTarget = level === 'top' ? { kind: 'main' } : level === 'machine' ? { kind: 'machine' } : { kind: 'project', repo }
  const icon = level === 'top' ? 'i-lucide-square-kanban' : level === 'machine' ? (local ? 'i-lucide-server' : 'i-lucide-laptop') : 'i-lucide-message-square-text'
  return { icon, name: coordinatorLabel(to, machine), hint: coordinatorDescription(to) }
}
