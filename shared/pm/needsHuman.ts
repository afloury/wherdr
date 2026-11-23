// A worker that cannot go on without a person (a login, a passkey, 2FA, a
// payment, an admin's approval) says so with its wherdr.report label:
// `needs-human: <kind> <url>`. The user gets a push straight away, again at 5
// and 15 minutes while it stays unanswered, and the task shows in its own
// *Needs you now* list (Home, Tasks to review). `needs-human: clear` ends it,
// as does the task being done or stopped, its worker's done being handled, or its step
// changing (it never outlives the step it was said in). Pure: server/utils/pmNeedsHuman.ts
// carries it out.
import { LABEL } from './run'

// kind: what is needed (login, passkey, 2fa, payment, approval…); url: where; at: since when; pushed: pushes sent; step: the step it was said in.
export interface NeedsHuman { kind: string, url?: string, at: number, pushed: number, step: number }

// Still open: its step is the task's current one.
export const needsHumanOpen = (task: { needsHuman?: NeedsHuman, step?: { at: number } }) => task.needsHuman && task.needsHuman.step === task.step?.at ? task.needsHuman : undefined

const PREFIX = 'needs-human:'
export const NEEDS_HUMAN_CMD = `hc label "$HC_TERMINAL_ID" "${LABEL.report}=${PREFIX} <kind> <url>"`
export const needsHumanLine = () =>
  `If you cannot go on without the user (a login, passkey, 2FA, payment or an admin's approval), run \`${NEEDS_HUMAN_CMD}\` (for example \`${PREFIX} login https://example.com/sign-in\`): they get a notification with a link to this task, again if they do not answer. Once they are through and you are working again, run \`hc label "$HC_TERMINAL_ID" "${LABEL.report}=${PREFIX} clear"\`.`

export const isNeedsHuman = (label: string | undefined) => !!label?.startsWith(PREFIX)
// The kind and url said, 'clear' to end it; undefined: not understood.
export function parseNeedsHuman(label: string): { kind: string, url?: string } | 'clear' | undefined {
  const m = /^needs-human:\s*(\S+)(?:\s+(\S+))?\s*$/.exec(label.trim())
  if (!m) return
  if (m[1] === 'clear') return 'clear'
  return { kind: m[1]!.slice(0, 40), ...(m[2] ? { url: m[2].slice(0, 500) } : {}) }
}

// The minutes after the first push at which it is sent again.
export const REPEAT_MIN = [5, 15]
// Pushes due now: the first at once, the others REPEAT_MIN after it; none once asked of all.
export const needsHumanDue = (n: NeedsHuman, now: number) =>
  n.pushed <= REPEAT_MIN.length && now - n.at >= (n.pushed ? REPEAT_MIN[n.pushed - 1]! * 60_000 : 0)

// The badge of the task's Your turn.
export const needsHumanTurn = (n: Pick<NeedsHuman, 'kind' | 'url'>) => `Needs you now: ${n.kind}${n.url ? ` ${n.url}` : ''}`
