import { checkoutMessage, planClose, type CloseKind, type ClosePlan, type CheckoutStatus } from '~/utils/closeFlow'

interface CloseStatus { git: boolean, modified?: number, untracked?: number, truncated?: boolean }

export async function confirmClose(kind: CloseKind, id: string, message: string, action: string): Promise<ClosePlan | null> {
  const plan = planClose(herdrState.value, kind, id)
  if (!plan.workspaces.length) return null
  const statuses: CheckoutStatus[] = []
  try {
    for (const w of plan.workspaces) {
      if (!w.repo && !w.worktree) continue
      const pane = herdrState.value.panes.find(p => p.workspace === w.id && p.cwd)
      if (!pane) throw new Error(tl(`État Git indisponible pour « ${w.label} ».`, `Git status unavailable for “${w.label}”.`))
      const changes = await api<CloseStatus>(`/api/close/status?pane=${encodeURIComponent(pane.id)}`)
      if (!changes.git) throw new Error(tl(`État Git indisponible pour « ${w.label} ».`, `Git status unavailable for “${w.label}”.`))
      statuses.push({
        label: w.label,
        modified: changes.modified || 0,
        untracked: changes.untracked || 0,
        truncated: changes.truncated,
      })
    }
  } catch (err) {
    toast((err as Error).message, true)
    return null
  }
  const details = statuses.length || plan.group ? `\n${checkoutMessage(statuses, plan.group, tl)}` : ''
  const processes = plan.group
    ? tl(` ${plan.panes.length} panes et leurs processus seront fermés.`, ` ${plan.panes.length} panes and their processes will close.`)
    : ''
  const groupAction = plan.group ? tl('Fermer le groupe', 'Close group') : action
  return await askConfirm(`${message}${processes}${details}`, groupAction) ? plan : null
}
