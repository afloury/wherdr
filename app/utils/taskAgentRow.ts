// A task agent's row: its title, role badge and how long it has been in its state.
import type { Pane } from '../../shared/types'
import type { TaskAgent } from '../../shared/pm/taskAgents'

const MAX_TITLE = 60

// '<KEY-n> <task title>', cut at 60 characters; '' when the user renamed the
// pane (its own name stays) or the pane is no task's.
export function taskAgentTitle(pane: Pick<Pane, 'label'>, agent?: TaskAgent): string {
  if (!agent || pane.label?.trim()) return ''
  const title = `${agent.shown} ${agent.title.trim()}`.trim()
  return title.length > MAX_TITLE ? `${title.slice(0, MAX_TITLE - 1).trimEnd()}…` : title
}

// '8 min', '2 h', '3 d'; '' without a known start (or a clock behind it).
export function stateDuration(since: number | undefined, now: number): string {
  if (since === undefined || now < since) return ''
  const min = Math.floor((now - since) / 60_000)
  if (min < 60) return `${Math.max(1, min)} min`
  const h = Math.floor(min / 60)
  return h < 24 ? `${h} h` : `${Math.floor(h / 24)} d`
}
