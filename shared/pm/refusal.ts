// A failed step action ("Merge: merge: 2 check(s) failed", see steps.ts) said
// for people, on the card and in the task sheet: what went wrong and what
// happens next, never a command. The raw error stays in the step state: it is
// for the engine, and the commands go to the agent in what the engine sends it.
import type { TaskLogEntry } from './run'
import type { StepState } from './steps'

// The engine's catch-up already asked the agent to bring its PR up to date
// (server/utils/pmMechanic.ts), since the step began.
export const agentCatchingUp = (c: { log?: TaskLogEntry[], state?: { since?: number } }) =>
  !!c.log?.some(e => e.by === 'engine' && e.at >= (c.state?.since ?? 0) && /^catch-up: (sent to the agent|started the worker again)/.test(e.text))

// short: the card's status line. long: the sheet, with what to do next.
// told: the engine already sent the agent its catch-up; waits: nothing for the user to do.
export interface Said { short: string, long: string, waits?: true }
const KNOWN: [RegExp, (m: RegExpMatchArray, told: boolean) => Said][] = [
  [/the PR head is not the task's commit/, () => ({
    short: 'The PR is not at the task\'s latest commit',
    long: 'The PR on GitHub is not at the task\'s latest commit: its branch moved (often the agent fixing a conflict or a check). Press again once the PR has the new commits.',
  })],
  [/(\d+) check\(s\) failed/, m => ({ short: 'checks failed', long: `${m[1]} check(s) failed on the PR: the agent is asked to fix them. Press again once they are green.` })],
  [/checks still running|waiting for check/, () => ({ short: 'checks still running', long: 'The PR\'s checks have not finished. Press again once they are green.' })],
  // "the PR conflicts with v3" (pmActions.ts), "conflict with v3 in a.ts" (the catch-up), GitHub's own words.
  [/conflicts? with (?!its )([\w./-]+)|conflict|not mergeable|cannot be cleanly created/i, (m, told) => {
    const short = `The PR conflicts with ${m[1] ?? 'its target branch'}`
    return told
      ? { short: `${short}: the agent is updating it`, long: `${short}: the agent is updating it. Press again once it is done.`, waits: true }
      : { short, long: `${short}: the engine brings it up to date, or asks the agent to. Press again once it is.` }
  }],
  [/base branch policy prohibits the merge|review is required|required status check/i, () => ({
    short: 'GitHub\'s branch rules refuse the merge',
    long: 'GitHub\'s rules for the target branch refuse the merge for now (a review or a check they require). Press again once they allow it.',
  })],
  [/no open PR for this task/, () => ({ short: 'no open PR', long: 'This task has no open PR to merge: the PR step has to open one first.' })],
]
// A shell command in an unknown error (GitHub's "Run the following…" hint): never shown.
const COMMAND = /&&|\b(gh|git) [a-z-]+ /

export function refusalSaid(text: string, told = false): Said {
  for (const [re, say] of KNOWN) {
    const m = text.match(re)
    if (m) return say(m, told)
  }
  if (COMMAND.test(text)) {
    const what = /\bmerge: /.test(text) ? 'GitHub refused the merge' : 'The step\'s action failed'
    return { short: what, long: `${what}. Press again, or ask the coordinator to look at the task.` }
  }
  // An engine reason already in words: on the card without its "merge: " prefix.
  return { short: text.replace(/^[\w-]+: /, ''), long: text }
}

// The card's call to the user, in words (the board, its Your turn lane, the
// decisions): a refused action says what went wrong, and there is none while
// the agent fixes it.
export function turnText(c: { yourTurn?: string, state?: StepState, log?: TaskLogEntry[] }): string | undefined {
  const y = c.state?.yourTurn
  if (!c.yourTurn || y?.reason !== 'action' || !y.error || !y.badge.endsWith(`: ${y.error}`)) return c.yourTurn
  const said = refusalSaid(y.error, agentCatchingUp(c))
  return said.waits ? undefined : `${y.badge.slice(0, -(y.error.length + 2))}: ${said.short}`
}
