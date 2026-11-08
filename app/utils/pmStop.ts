// Stop a task and take a stopped one up again, from the board, the task sheet
// and Decisions (server/utils/pmStop.ts). Archive asks first: the task ends.
// Delete asks first too: a task never started leaves the board.
import type { Resume } from '#shared/pm/stop'

export const RESUME_LABEL: Record<Resume, [string, string]> = {
  'continue': ['Continue', 'Continuer'],
  'as-is': ['Take it as it is', 'Prendre tel quel'],
  'archive': ['Archive', 'Archiver'],
}

export const stopTaskApi = (id: string, why = '') => api('/api/pm/task-stop', { id, why })

// false: the user cancelled. Only a task never started (card.removable).
export async function removeTaskApi(id: string) {
  if (!(await askConfirm(tl('Delete this task? It never started: it leaves the board for good.', 'Supprimer cette tâche ? Elle n’a jamais été lancée : elle quitte le tableau pour de bon.'), tl('Delete', 'Supprimer')))) return false
  await api('/api/pm/task-remove', { id })
  return true
}

// false: the user cancelled the archive.
export async function resumeTaskApi(id: string, how: Resume) {
  if (how === 'archive' && !(await askConfirm(tl('Archive this task? Its agent stays stopped; its worktree and branch are kept.', 'Archiver cette tâche ? Son agent reste arrêté ; son worktree et sa branche sont gardés.'), tl('Archive', 'Archiver')))) return false
  await api('/api/pm/task-resume', { id, how })
  return true
}
