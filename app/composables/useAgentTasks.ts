// What each task asks of the user (GET /api/pm/agents), for the sidebar rows
// of its agents: Blocked or Your turn, as on the board.
import { markOfTerminal, type AgentTask } from '#shared/pm/blocked'
import type { Pane } from '#shared/types'

export const agentTasks = ref<AgentTask[]>([])
export const loadAgentTasks = () => api<AgentTask[]>('/api/pm/agents').then((v) => { agentTasks.value = Array.isArray(v) ? v : [] }, () => {})

// Read while the list is mounted.
export function useAgentTasks(every = 15_000) {
  let timer: ReturnType<typeof setInterval> | undefined
  onMounted(() => { loadAgentTasks(); timer = setInterval(loadAgentTasks, every) })
  onBeforeUnmount(() => clearInterval(timer))
}

const statusOf = (terminal: string) => herdrState.value?.panes.find(p => p.coreAddress === terminal)?.status
export const paneTaskMark = (p: Pick<Pane, 'coreAddress'>) => markOfTerminal(agentTasks.value, p.coreAddress, statusOf)
