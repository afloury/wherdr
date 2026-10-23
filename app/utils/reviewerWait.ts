// A task whose reviewer, not its agent, waits for you (1.x stage
// `reviewneeds`: "The reviewer shows a dialog: open it and answer"). The
// dialog is on the reviewer's pane, never on the agent's (done by then).
import type { Pane } from '#shared/types'
import type { TaskReviewer } from '#shared/projectsTasks'

// open:  its pane is shown and waits on a dialog: the panel opens it.
// quiet: its pane is shown but waits on nothing now (the board is behind).
// gone:  its pane is closed: no dialog is left to answer.
// hidden: its pane is open in a session this device does not show: switching
//        to that session shows it.
// away:  wherdr cannot reach its pane (its session is not open, no pane named,
//        or its machine does not answer).
export type ReviewerWait = 'open' | 'quiet' | 'gone' | 'hidden' | 'away'

export interface ReviewerSeen {
  stage: string | undefined
  reviewer: TaskReviewer | null | undefined
  panes: readonly Pick<Pane, 'id' | 'status'>[]
  // The panes of every open session (the device shows one per machine).
  everywhere?: readonly Pick<Pane, 'id'>[]
  // Herdr's state is read, and the task's machine answers.
  live: boolean
}

// null: not a reviewer's wait (the agent's own keep today's banner).
export function reviewerWait(s: ReviewerSeen): ReviewerWait | null {
  if (s.stage !== 'reviewneeds') return null
  const id = s.reviewer?.pane
  if (!id || !s.live) return 'away'
  const p = s.panes.find(x => x.id === id)
  if (!p) return s.everywhere?.some(x => x.id === id) ? 'hidden' : 'gone'
  return p.status === 'blocked' ? 'open' : 'quiet'
}
