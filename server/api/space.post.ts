// Actions on spaces, tabs and panes (new tab, split, rename,
// close, move, reorder): the call goes to the machine of the target object.
import { type HerdrStep, SpaceActionError, dropSteps, spaceCall, spaceResult, swapSteps } from '../../shared/spaceActions'
import type { DropSide } from '../../shared/layout'
import { HerdrError, herdrOn } from '../utils/herdr'
import { log } from '../utils/env'
import { poll } from '../utils/state'

export default defineApi(async (_event, body) => {
  let call
  try { call = spaceCall(body) }
  catch (e) {
    if (e instanceof SpaceActionError) throw new HerdrError(e.code, e.message)
    throw e
  }
  if (call.method === 'pane.swap') {
    await swapPanes(call.machine, String(call.params.pane_id), call.params.direction as string)
    log(`espace : pane.swap${call.machine ? ` (${call.machine})` : ''}`)
    poll()
    return { ok: true }
  }
  if (call.method === 'pane.drop') {
    const { pane_id: pane, target_pane_id: target, side } = call.params as { pane_id: string, target_pane_id: string, side: DropSide }
    const snap = await herdrOn(call.machine, 'session.snapshot', {}, 5000)
    await runSteps(call.machine, stepsOf(() => dropSteps(snap?.snapshot || snap, pane, target, side)))
    log(`espace : pane.drop ${side}${call.machine ? ` (${call.machine})` : ''}`)
    poll()
    return { ok: true }
  }
  const r = await herdrOn(call.machine, call.method, call.params)
  log(`espace : ${call.method}${call.machine ? ` (${call.machine})` : ''}`)
  poll()
  return { ok: true, ...spaceResult(call, r) }
})

// Swap with the neighbour Herdr designates, then focus restored (swapSteps).
async function swapPanes(machine: string, pane: string, direction: string) {
  const [snap, nb] = await Promise.all([
    herdrOn(machine, 'session.snapshot', {}, 5000),
    herdrOn(machine, 'pane.neighbor', { pane_id: pane, direction }),
  ])
  await runSteps(machine, stepsOf(() => swapSteps(snap?.snapshot || snap, pane, nb?.neighbor?.neighbor_pane_id ?? null)))
}

function stepsOf(f: () => HerdrStep[]) {
  try { return f() }
  catch (e) {
    if (e instanceof SpaceActionError) throw new HerdrError(e.code, e.message)
    throw e
  }
}

// Steps one after the other. A pane.move may return a new ID (other
// space): the following steps follow the pane.
async function runSteps(machine: string, steps: HerdrStep[]) {
  const renamed = new Map<string, string>()
  const fix = (v: unknown): unknown => (typeof v === 'string' ? renamed.get(v) ?? v
    : v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fix(x)])) : v)
  for (const s of steps) {
    const r = await herdrOn(machine, s.method, fix(s.params) as Record<string, unknown>)
    const m = r?.move_result
    if (m?.previous_pane_id && m.pane?.pane_id && m.previous_pane_id !== m.pane.pane_id) {
      for (const [k, v] of renamed) if (v === m.previous_pane_id) renamed.set(k, m.pane.pane_id)
      renamed.set(m.previous_pane_id, m.pane.pane_id)
    }
  }
}
