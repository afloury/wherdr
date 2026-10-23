// Which view a task's side panel shows: its conversation, its terminal, its
// reviewer's pane (while a review runs) or the task itself. A task with
// nothing to talk to opens on the task.

export type TaskPanelTab = 'chat' | 'term' | 'reviewer' | 'task'

export interface TaskPanelViews {
  // Something to show under Conversation: an agent pane (its conversation or
  // its setup output) or a reply passed on by herdr-projects.
  chat: boolean
  // A pane whose terminal can be opened.
  term: boolean
  // Its reviewer's pane, shown in Herdr while a review runs.
  reviewer?: boolean
}

export function taskPanelTabs(v: TaskPanelViews): TaskPanelTab[] {
  return [...(v.chat ? ['chat' as const] : []), ...(v.term ? ['term' as const] : []), ...(v.reviewer ? ['reviewer' as const] : []), 'task']
}

// The user's own choice while it is still offered, else Conversation when
// there is one, else the task.
export function taskPanelTab(v: TaskPanelViews, choice: TaskPanelTab | null | undefined): TaskPanelTab {
  const tabs = taskPanelTabs(v)
  if (choice && tabs.includes(choice)) return choice
  return v.chat ? 'chat' : 'task'
}

// Tabs picked by hand, per task (`machine|id`), for as long as the app runs:
// closing and reopening a task's panel keeps its view.
const chosen = new Map<string, TaskPanelTab>()
export const taskPanelChoice = (key: string) => chosen.get(key) ?? null
export function setTaskPanelChoice(key: string, tab: TaskPanelTab | null) {
  if (tab) chosen.set(key, tab)
  else chosen.delete(key)
}

// The tab a "Needs you" banner offers to jump to: never the one already shown.
// From the terminal, the conversation (where the answer goes); elsewhere, the terminal.
export function needsJumpTab(tabs: TaskPanelTab[], selected: TaskPanelTab): TaskPanelTab | null {
  const want: TaskPanelTab = selected === 'term' ? 'chat' : 'term'
  return tabs.includes(want) ? want : null
}
