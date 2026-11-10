// Action buttons (shared/uiActions.ts) on the server: `wherdr pm ui action`
// stores the card in the coordinator's record; GET /api/ui/card reads it as it
// stands now; POST /api/ui/act runs it on the user's click, through the task
// sheet's own handlers, once its stamp still holds.
import { randomBytes } from 'node:crypto'
import type { Turn } from '../../shared/pm/coordinator'
import { shownTaskId } from '../../shared/pm/projectKey'
import { taskPlan, type Task } from '../../shared/pm/run'
import { actionBlock, actionLabel, actionRefusal, actionStamp, cardNow, keepCards, outcomeText, type UiAction, type UiCard } from '../../shared/uiActions'
import { HerdrError } from './herdr'
import { userStep } from './pmBoard'
import type { PmLaunchDeps } from './pmLaunch'
import { resumeTask } from './pmStop'
import type { PmStore } from './pmStore'

async function stampOf(store: PmStore, kind: UiAction, task: Task | null) {
  if (!task) return { stamp: null, plan: [] }
  const [t, p] = [await store.workflow(task.project), await store.project(task.project)]
  const plan = t ? taskPlan(t, task, p ?? undefined) : []
  return { stamp: actionStamp(kind, task, plan), plan }
}

// `ui action <kind> <task>`: scope, the coordinator's key (its record keeps the card).
export async function addAction(store: PmStore, o: { scope: string, turn: Turn, by: string, kind: UiAction, task: Task }) {
  if (o.turn !== 'user') throw new HerdrError('refused', 'ui action is only for a turn that comes from the user, never in a wake')
  const shown = shownTaskId(await store.projects(), o.task.id)
  const { stamp, plan } = await stampOf(store, o.kind, o.task)
  const why = actionRefusal(o.kind, stamp, shown)
  if (why) throw new HerdrError('refused', why)
  const rec = await store.coordinator(o.scope)
  if (!rec) throw new HerdrError('not_found', 'No coordinator for this project')
  const now = Date.now()
  const card: UiCard = { id: randomBytes(8).toString('hex'), by: o.by, at: now, kind: o.kind, task: o.task.id, shown, label: actionLabel(o.kind, shown, plan, o.task), stamp: stamp!, state: 'open' }
  await store.saveCoordinator({ ...rec, cards: keepCards(rec.cards ?? [], card, now) })
  return {
    button: card.label,
    note: `Nothing ran: the user clicks it. End your reply with this block, after the sentence that explains it:\n${actionBlock(card.id)}`,
  }
}

async function find(store: PmStore, id: unknown) {
  if (typeof id !== 'string') return null
  for (const rec of await store.coordinators()) {
    const card = rec.cards?.find(c => c.id === id)
    if (card) return { rec, card }
  }
  return null
}

// The card as it stands now (stale once its task changed), or null.
export async function readCard(store: PmStore, id: unknown): Promise<UiCard | null> {
  const hit = await find(store, id)
  if (!hit) return null
  const task = await store.task(hit.card.task)
  const { stamp } = await stampOf(store, hit.card.kind, task)
  const card = cardNow(hit.card, stamp, Date.now()), turn = task?.step?.yourTurn
  // Its step's action refused at an earlier click: still said after a reload.
  return card.state === 'open' && card.kind === 'step' && turn?.reason === 'action' ? { ...card, refused: turn.badge } : card
}

// The user's click. A CLI token never clicks: only the app's own session.
// Not open (done, stale): nothing runs, the card says why.
export async function actOnCard(deps: PmLaunchDeps, id: unknown, authorization: unknown): Promise<UiCard> {
  if (authorization) throw new HerdrError('forbidden', 'Only the user\'s click in wherdr runs an action, never a token')
  const card = await readCard(deps.store, id)
  if (!card) throw new HerdrError('not_found', 'Unknown action')
  if (card.state !== 'open' || card.kind === 'open') return card
  const task = card.kind === 'resume' ? await resumeTask(deps, card.task, 'continue', { who: 'user' }, 'user') : await userStep(deps, card.task)
  // The step's action refused (a merge on a PR in conflict, red checks): the
  // card stays open with its reason, as the task sheet shows it, for a retry.
  const turn = task.step?.yourTurn
  if (card.kind === 'step' && turn?.reason === 'action') return { ...card, refused: turn.badge }
  const same = card.kind === 'step' && (await stampOf(deps.store, 'step', task)).stamp === card.stamp
  const done: UiCard = { ...card, state: 'done', outcome: { text: outcomeText(card, same ? task : undefined), at: Date.now() } }
  const hit = await find(deps.store, card.id)
  if (hit) await deps.store.saveCoordinator({ ...hit.rec, cards: hit.rec.cards!.map(c => (c.id === card.id ? done : c)) })
  return done
}
