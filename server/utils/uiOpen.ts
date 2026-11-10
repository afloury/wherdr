// `ui open` on the server, for `wherdr alfred` and `wherdr pm`: checks the
// link and the turn (shared/uiOpen.ts), then sends the event on /ws/events to
// the one app the user is on: of those showing the agent's own conversation,
// the one they used last (shared/uiOpen.ts `uiTarget`).
import type { Pane } from '../../shared/types'
import type { Turn } from '../../shared/pm/coordinator'
import { uiBlock, uiLink, uiOpenRefusal, uiShow, uiTarget, type UiClient, type UiOpenEvent } from '../../shared/uiOpen'
import { HerdrError } from './herdr'
import type { PmStore } from './pmStore'

type Client = UiClient & { send: (data: string) => void }

export interface UiOpenDeps { store: PmStore, panes: () => Pane[], clients: () => Iterable<Client> }

// scope: the token's (MAIN or a project key); by: the name the app shows.
export async function openUi(deps: UiOpenDeps, o: { scope: string, main: boolean, raw: unknown, turn: Turn, by: string }) {
  const link = uiLink(o.raw)
  const own = (o.main ? null : await deps.store.project(o.scope)) ?? { key: o.scope }
  const why = uiOpenRefusal(link, o.turn, own, o.main)
  if (why) throw new HerdrError('refused', why)
  const terminal = (await deps.store.coordinator(o.scope))?.terminal
  const pane = terminal ? deps.panes().find(p => p.coreAddress === terminal) : undefined
  const to = pane ? uiTarget([...deps.clients()], pane.id, Date.now()) : null
  if (!to) throw new HerdrError('not_found', 'No open wherdr is in use on your conversation now: give the user the link instead')
  const show = uiShow(to.device, link!)
  const event: UiOpenEvent = { type: 'ui-open', pane: pane!.id, link: link!, by: o.by, show }
  try { to.send(JSON.stringify(event)) }
  catch { throw new HerdrError('not_found', 'The wherdr the user is on just closed: give the user the link instead') }
  const where = show === 'panel' ? 'in the Settings panel beside your conversation' : 'as a card above the message field'
  return {
    opened: link,
    'opened on': to.device ?? 'phone',
    note: `Shown ${where} on the user's ${to.device ?? 'phone'}; the user closes it. Nothing was changed. End your reply with this block, so the card stays in the conversation:\n${uiBlock(link!)}`,
  }
}
