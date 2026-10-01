// Agents' Git worktrees: list (settings) and removal with confirmation
// (agents stopped, uncommitted changes -> "Force"). The branch stays.
import type { WorktreeInfo } from '#shared/types'

export const worktrees = ref<WorktreeInfo[] | null>(null)
export const worktreesLoading = ref(false)

export async function loadWorktrees() {
  worktreesLoading.value = true
  try { worktrees.value = await api<WorktreeInfo[]>('/api/worktrees') }
  catch (err) { toast((err as Error).message, true) }
  finally { worktreesLoading.value = false }
}

export const worktreeName = (w: WorktreeInfo) => w.branch || w.path.split('/').pop() || w.path

export async function removeWorktreeFlow(w: WorktreeInfo): Promise<boolean> {
  const name = worktreeName(w)
  const warn = w.agents
    ? tl(` ${w.agents > 1 ? `Its ${w.agents} agents will be stopped` : 'Its agent will be stopped'}.`, ` ${w.agents > 1 ? `Ses ${w.agents} agents seront arrêtés` : 'Son agent sera arrêté'}.`)
    : w.panes ? tl(' Its terminals will be closed.', ' Ses terminaux seront fermés.') : ''
  const keep = w.branch ? tl(` Branch ${w.branch} is kept.`, ` La branche ${w.branch} est gardée.`) : ''
  if (!await askConfirm(tl(`Delete worktree ${name} (${w.path})?${warn}${keep}`, `Supprimer le worktree ${name} (${w.path}) ?${warn}${keep}`), t('Delete'))) return false
  let force = false
  for (;;) {
    try {
      await api('/api/worktrees/remove', { machine: w.machine, path: w.path, force })
      toast(tl(`Worktree ${name} deleted`, `Worktree ${name} supprimé`))
      if (worktrees.value) worktrees.value = worktrees.value.filter(x => !(x.machine === w.machine && x.path === w.path))
      return true
    } catch (err) {
      if (!force && err instanceof ApiError && err.code === 'dirty') {
        if (!await askConfirm(tl(`${name} has uncommitted changes. Delete them with the worktree?`, `${name} contient des modifications non commitées. Les supprimer avec le worktree ?`), t('Force delete'))) return false
        force = true
        continue
      }
      toast((err as Error).message, true)
      return false
    }
  }
}
