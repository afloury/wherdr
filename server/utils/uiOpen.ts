// `ui open` on the server, for `wherdr alfred` and `wherdr pm`: checks the
// link and the turn (shared/uiOpen.ts), then sends the event on /ws/events to
// the open apps that show the agent's own conversation, and to no other.
import type { Pane } from '../../shared/types'
import type { Turn } from '../../shared/pm/coordinator'
import { uiLink, uiOpenRefusal, type UiOpenEvent } from '../../shared/uiOpen'
import { HerdrError } from './herdr'
import type { PmStore } from './pmStore'

interface Client { send: (data: string) => void, pane: string | null }

export interface UiOpenDeps { store: PmStore, panes: () => Pane[], clients: () => Iterable<Client> }

// scope: the token's (MAIN or a project key); by: the name the app shows.
export async function openUi(deps: UiOpenDeps, o: { scope: string, main: boolean, raw: unknown, turn: Turn, by: string }) {
  const link = uiLink(o.raw)
  const own = (o.main ? null : await deps.store.project(o.scope)) ?? { key: o.scope }
  const why = uiOpenRefusal(link, o.turn, own, o.main)
  if (why) throw new HerdrError('refused', why)
  const terminal = (await deps.store.coordinator(o.scope))?.terminal
  const pane = terminal ? deps.panes().find(p => p.coreAddress === terminal) : undefined
  const event: UiOpenEvent = { type: 'ui-open', pane: pane?.id ?? '', link: link!, by: o.by }
  const msg = JSON.stringify(event)
  let sent = 0
  for (const c of pane ? deps.clients() : []) {
    if (c.pane !== pane!.id) continue
    try { c.send(msg); sent++ }
    catch { /* client gone */ }
  }
  if (!sent) throw new HerdrError('not_found', 'No open wherdr shows your conversation: give the user the link instead')
  return { opened: link, clients: sent, note: 'Shown beside your conversation (a card on a phone); the user closes it. Nothing was changed' }
}
