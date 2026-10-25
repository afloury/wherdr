// Done on the Board. The Board is for the work in progress: Done is history, so
// it is hidden by default, in both views, on a phone and on a computer. One
// toggle ("Done · 9") shows it and hides it again; the choice follows the user
// across devices (kept on the server). Shown, it follows herdr-projects' rule:
// newest first, only the latest few, then "N more" (herdr-projects
// docs/board.md, "The list: five groups").
import { TASK_GROUPS, type TaskGroup, type TaskRow, newerFirst } from '../../shared/projectsTasks'

// The choice: '1' shown, anything else (nothing stored) hidden.
export const BOARD_DONE_KEY = 'boardDone'
export const boardDoneShown = (stored: string | null | undefined) => stored === '1'
export const boardDoneStored = (shown: boolean) => (shown ? '1' : '0')

// Done tasks shown until "N more": per column (herdr-projects shows five), and
// per repo's lane, where every repo has its own cell.
export const DONE_LATEST = 5
export const DONE_LATEST_REPO = 3

// The groups the Board shows, in the board's order.
export const boardGroups = (showDone: boolean): TaskGroup[] => TASK_GROUPS.filter(g => showDone || g !== 'done')

// The phone's tab: the one picked, unless it is Done and Done is hidden.
export const boardPhoneColumn = (picked: TaskGroup, showDone: boolean): TaskGroup => (picked === 'done' && !showDone ? 'needs' : picked)

// One cell's cards: Done shows its latest few until all are asked for.
export function boardCell<T>(group: TaskGroup, all: T[], showAll: boolean, latest: number): { cards: T[], hidden: number } {
  const cards = group === 'done' && !showAll ? all.slice(0, latest) : all
  return { cards, hidden: all.length - cards.length }
}

// Done across machines: each machine's list is newest first, but the Board
// puts them one after the other. Newest created first whatever the machine;
// cards with no creation time keep their order, after the others.
export const doneNewestFirst = <T extends { task: Pick<TaskRow, 'created'> }>(cards: T[]): T[] => [...cards].sort((a, b) => newerFirst(a.task, b.task))
