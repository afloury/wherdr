// The tasks' running agents and what each task asks of the user, for the
// sidebar rows: blocked, Your turn, or a step waiting for its agent.
import { board } from '../../utils/pmBoard'
import { pmStore } from '../../utils/pmStore'
import type { AgentTask } from '../../../shared/pm/blocked'

export default defineApi(async (): Promise<AgentTask[]> => {
  const store = pmStore()
  if (!await store.enabled()) return []
  return (await board(store)).cards.filter(c => c.terminals?.length).map(c => ({
    id: c.id, holder: c.holder, terminals: c.terminals!,
    ...(c.terminal ? { terminal: c.terminal } : {}),
    ...(c.yourTurn ? { yourTurn: c.yourTurn } : {}),
    ...(c.blocked ? { blocked: c.blocked } : {}),
    ...(c.awaits ? { awaits: c.awaits } : {}),
  }))
})
