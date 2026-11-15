import { agentsClosing, planClose, widerClose, type CloseKind, type ClosePlan } from '~/utils/closeFlow'

// What a close confirmation says about its target, written from the plan
// computed right now (names, counts, what stops).
export type CloseText = (plan: ClosePlan) => { message: string, action: string }

// Asks, then checks the structure again before closing: if the close would now
// take more than what was shown (a pane added to the space, the last other pane
// gone…), the updated confirmation is shown again. A target that disappeared
// closes nothing.
export async function confirmClose(kind: CloseKind, id: string, text: CloseText): Promise<ClosePlan | null> {
  let shown: ClosePlan | null = null
  for (let round = 0; round < 4; round++) {
    const plan = planClose(herdrState.value, kind, id)
    if (!plan.workspaces.length) return null
    if (shown && !widerClose(shown, plan)) return plan
    const { message, action } = text(plan)
    const agents = agentsClosing(plan, tl)
    if (!(await askConfirm(`${message}${agents ? `\n\n${agents}` : ''}`, action))) return null
    shown = plan
  }
  return null
}
