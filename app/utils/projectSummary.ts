// The summary line of a repo group on the home list, under its coordinator:
// "4 TASKS · 1 YOUR TURN · 1 LIMIT". It counts the tasks' rows only (the
// coordinator has its own row and state above it), so it says the same thing
// folded or not.
import type { Member } from '../../shared/boardLinks'
import { rowGroup } from '../../shared/spaces'

export interface TaskSummary { tasks: number, blocked: number, working: number, limit: number }

export function taskSummary(members: Member[]): TaskSummary {
  const s: TaskSummary = { tasks: members.length, blocked: 0, working: 0, limit: 0 }
  for (const m of members) {
    const g = rowGroup(m.row)
    if (g === 'blocked') s.blocked++
    else if (g === 'working') s.working++
    // The pane the row shows: the one its card tags with "Limit".
    if (m.row.lead.usageLimit) s.limit++
  }
  return s
}

export type SummaryPart = { key: 'tasks' | 'blocked' | 'working' | 'limit', text: string }

// The parts of the line, in reading order; a count of zero is left out
// (except the number of tasks).
export function summaryParts(s: TaskSummary, tl: (en: string, fr: string) => string): SummaryPart[] {
  const parts: SummaryPart[] = [{
    key: 'tasks',
    text: !s.tasks ? tl('No tasks', 'Aucune tâche') : s.tasks === 1 ? tl('1 task', '1 tâche') : tl(`${s.tasks} tasks`, `${s.tasks} tâches`),
  }]
  if (s.blocked) parts.push({ key: 'blocked', text: tl(`${s.blocked} your turn`, `${s.blocked} à toi`) })
  if (s.working) parts.push({ key: 'working', text: tl(`${s.working} working`, `${s.working} en cours`) })
  if (s.limit) parts.push({ key: 'limit', text: s.limit === 1 ? tl('1 limit', '1 limite') : tl(`${s.limit} limits`, `${s.limit} limites`) })
  return parts
}
