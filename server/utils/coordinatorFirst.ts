// A coordinator's first messages (its start prompt, the first-start workflow proposal,
// card notes): typed one after another once its session is ready, however long it takes
// to start (bounded by queueWatchMs), never dropped silently. Each outcome goes to the
// project's log; one not delivered stays on its record (undelivered) so that the
// coordinator row and Alfred say so, with Send again (resendFirst).
// Coordinators start one after another: each start waits until the one before is up
// (its first message typed or failed), at most startGapMs, so that several Claude
// sessions starting at once (the v2 import card) do not slow each other past the bound.
import { HerdrError } from './herdr'
import { sendFirstMessage, type CoreAdminDeps } from './coreCreate'
import type { PmStore } from './pmStore'

export type FirstDeps = CoreAdminDeps & { store: Pick<PmStore, 'coordinator' | 'saveCoordinator' | 'logProject'>, startGapMs?: number }
export interface Undelivered { texts: string[], why: string, at: number }

const BY = 'wherdr'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const log = (deps: FirstDeps, key: string, text: string) => deps.store.logProject(key, { by: BY, text }).catch(() => {})

// The record of this conversation only: a later start replaced it otherwise.
async function mark(deps: FirstDeps, key: string, address: string, undelivered?: Undelivered) {
  const rec = await deps.store.coordinator(key)
  if (!rec || rec.terminal !== address || (!undelivered && !rec.undelivered)) return
  const { undelivered: _old, ...rest } = rec
  await deps.store.saveCoordinator({ ...rest, ...(undelivered ? { undelivered } : {}) })
}

// up: called once with the first outcome (the session is up, or gone).
export async function deliverFirst(deps: FirstDeps, key: string, address: string, texts: string[], up: () => void = () => {}): Promise<'sent' | 'failed'> {
  const limit = deps.queueWatchMs ?? 600_000, end = Date.now() + limit
  let i = 0, why = '', queued = false
  while (i < texts.length) {
    const t = await deps.call<{ state?: string }>('terminal.get', { terminal: address }, 3000).catch(() => null)
    if (!t?.state || t.state === 'finished') { why = 'its session ended before it was ready'; break }
    const r = await sendFirstMessage(deps, address, texts[i]!).catch(() => 'skipped' as const)
    if (r === 'sent') { i++; up(); continue }
    if (Date.now() >= end) { why = `it was not ready after ${Math.round(limit / 60_000)} min`; break }
    if (!queued) {
      queued = true
      await log(deps, key, `first message queued (${r === 'dialog' ? 'a dialog waits for an answer' : r === 'installing' ? 'it is installing an update' : 'not ready yet'}): typed once it is ready`)
    }
    await sleep((deps.pollMs ?? 500) * 2)
  }
  up()
  if (!why) {
    if (texts.length) await log(deps, key, `first message sent${texts.length > 1 ? ` (${texts.length} messages)` : ''}`)
    await mark(deps, key, address)
    return 'sent'
  }
  await log(deps, key, `first message not delivered: ${why}`)
  await mark(deps, key, address, { texts: texts.slice(i), why, at: Date.now() })
  return 'failed'
}

// One start at a time: resolves once the start before is up (or after startGapMs);
// the caller calls the returned function once its own session is up.
let previous: Promise<void> = Promise.resolve()
export async function startTurn(deps: Pick<FirstDeps, 'startGapMs'>): Promise<() => void> {
  const before = previous
  let done!: () => void
  previous = new Promise<void>(r => (done = r))
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([before, new Promise<void>(r => (timer = setTimeout(r, deps.startGapMs ?? 20_000)))])
  clearTimeout(timer)
  return done
}

// Send again: the messages not delivered to the running conversation, queued again.
export async function resendFirst(deps: FirstDeps, key: string) {
  const rec = await deps.store.coordinator(key)
  if (!rec?.undelivered || !rec.terminal) throw new HerdrError('not_found', 'No first message waits to be sent again')
  const { undelivered, ...rest } = rec
  await deps.store.saveCoordinator(rest)
  void deliverFirst(deps, key, rec.terminal, undelivered.texts)
  return { queued: undelivered.texts.length }
}
