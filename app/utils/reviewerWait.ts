// A task whose reviewer, not its agent, waits for you (1.x stage
// `reviewneeds`: "The reviewer shows a dialog: open it and answer"). The
// dialog is on the reviewer's pane, never on the agent's (done by then).
import type { Pane } from '#shared/types'
import type { TaskReviewer } from '#shared/projectsTasks'

// open:  its pane is shown and waits on a dialog: the panel opens it.
// quiet: its pane is shown but waits on nothing now (the board is behind).
// gone:  its pane is closed: no dialog is left to answer.
// away:  wherdr cannot reach its pane (its session is not open, no pane named,
//        or its machine does not answer).
export type ReviewerWait = 'open' | 'quiet' | 'gone' | 'away'

export interface ReviewerSeen {
  stage: string | undefined
  reviewer: TaskReviewer | null | undefined
  panes: readonly Pick<Pane, 'id' | 'status'>[]
  // Herdr's state is read, and the task's machine answers.
  live: boolean
}

// null: not a reviewer's wait (the agent's own keep today's banner).
export function reviewerWait(s: ReviewerSeen): ReviewerWait | null {
  if (s.stage !== 'reviewneeds') return null
  const id = s.reviewer?.pane
  if (!id || !s.live) return 'away'
  const p = s.panes.find(x => x.id === id)
  if (!p) return 'gone'
  return p.status === 'blocked' ? 'open' : 'quiet'
}
