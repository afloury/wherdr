// Decisions: everything that waits for the user's choice, grouped, the
// recommended answer first. Pure: the server (server/utils/pmDecisions.ts)
// gathers the cards, tasks, coordinators and wakes, the screen shows the list.
import type { Card } from './board'
import type { Task, WaitKind } from './run'
import type { Wake } from './wakes'
import { CHOICES, type Choice } from './verdict'

// agent: a permission, question or login an agent waits on. arbitrate: the
// after-N rule hands a review to the user. proposal: a template change of the
// coordinator. step: a step that ends with the user's button (Merged), or an
// action that failed. overdue: a step over its timeout. coordinator: a wake
// it never acked.
export const DECISION_GROUPS = ['agent', 'arbitrate', 'proposal', 'step', 'overdue', 'coordinator'] as const
export type DecisionGroup = typeof DECISION_GROUPS[number]

export interface Decision {
  id: string // stable while the same thing waits: the grouped push tells only new ones
  group: DecisionGroup
  project: string
  task?: string
  title: string // the task's title, or the project's name
  text: string // what is asked
  kind?: WaitKind
  terminal?: string // the agent to answer in
  options?: Choice[] // arbitrate: recommended first
  recommend?: Choice
  label?: string // step: the button
  at: number
}

export interface DecisionsInput {
  cards: Card[]
  tasks: Pick<Task, 'id' | 'state' | 'waiting' | 'waitKind'>[]
  coordinators: { project: string, name: string, proposal?: { at: number, said?: string } }[]
  wakes: Wake[]
}

const KIND_TEXT: Record<WaitKind, string> = { permission: 'Asks for a permission', question: 'Asks a question', auth: 'Needs its login again' }

export function decisionsOf({ cards, tasks, coordinators, wakes }: DecisionsInput): Decision[] {
  const out: Decision[] = []
  for (const c of cards) {
    const t = tasks.find(x => x.id === c.id)
    const base = { project: c.project, task: c.id, title: c.title, at: c.state?.since ?? 0, ...(c.terminal ? { terminal: c.terminal } : {}) }
    if (t?.state === 'waiting' && t.waitKind)
      out.push({ ...base, id: `agent:${c.id}:${t.waitKind}`, group: 'agent', kind: t.waitKind, text: t.waiting?.split('\n')[0] || KIND_TEXT[t.waitKind] })
    const y = c.state?.yourTurn
    if (!y || c.state?.done) continue
    const id = `${y.reason}:${c.id}:${c.step}:${y.badge}`
    if (y.reason === 'rounds' && y.advice) {
      const a = y.advice
      // The coordinator's options when it has some, else any choice (the user may choose any).
      const options = a.options.length ? [...a.options] : [...CHOICES]
      const recommend = (options as string[]).includes(a.outcome) ? a.outcome as Choice : a.options.length === 1 ? a.options[0] : undefined
      out.push({ ...base, id, group: 'arbitrate', text: `${y.badge}: ${a.why}`, options: recommend ? [recommend, ...options.filter(o => o !== recommend)] : options, ...(recommend ? { recommend } : {}) })
    } else if (y.reason === 'timeout') out.push({ ...base, id, group: 'overdue', text: y.badge })
    else out.push({ ...base, id, group: 'step', text: y.badge, label: c.userLabel || 'Try again' })
  }
  for (const c of coordinators)
    if (c.proposal) out.push({ id: `proposal:${c.project}:${c.proposal.at}`, group: 'proposal', project: c.project, title: c.name, text: c.proposal.said ? `After your message: “${c.proposal.said}”` : 'Template change proposed', at: c.proposal.at })
  // A wake that got no answer, unless the coordinator acked a later one.
  for (const c of coordinators) {
    const mine = wakes.filter(w => w.coordinator === c.project).sort((a, b) => a.createdAt - b.createdAt)
    const last = mine.findLast(w => w.ended === 'unanswered')
    if (last && !mine.some(w => w.createdAt > last.createdAt && w.ackedAt))
      out.push({ id: `wake:${last.id}`, group: 'coordinator', project: c.project, title: c.name, text: `The coordinator did not answer wake ${last.id}: ${last.reasons[0]?.slice(0, 160) ?? ''}`, at: last.endedAt ?? last.createdAt })
  }
  const rank = (d: Decision) => DECISION_GROUPS.indexOf(d.group)
  return out.sort((a, b) => rank(a) - rank(b) || Number(!!b.recommend) - Number(!!a.recommend) || a.at - b.at)
}

// The groups shown, in order, without the empty ones.
export const decisionGroups = (ds: Decision[]) =>
  DECISION_GROUPS.map(group => ({ group, items: ds.filter(d => d.group === group) })).filter(g => g.items.length)

// One push for what is new since the last one; null when nothing is new.
// The same tag replaces the previous push on the phone.
export function decisionsPush(ds: Decision[], told: Set<string>): { title: string, body: string } | null {
  const fresh = ds.filter(d => !told.has(d.id))
  if (!fresh.length) return null
  const n = ds.length
  return {
    title: n === 1 ? '1 decision waits for you' : `${n} decisions wait for you`,
    body: [...fresh.slice(0, 3).map(d => `${d.task ?? d.project}: ${d.text.slice(0, 80)}`), ...(fresh.length > 3 ? [`+${fresh.length - 3} more`] : [])].join('\n'),
  }
}
