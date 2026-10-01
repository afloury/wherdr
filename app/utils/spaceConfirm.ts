// Confirmation text before closing a tab or a space: what will be
// stopped (named agents, terminals), and the space that goes with its last
// tab. Pure (tested): the language comes with `tl`.
import type { Pane } from '../../shared/types'
import { closeSummary } from '../../shared/spaceActions'
import { paneTitle } from '../../shared/paneTitle'

type Tl = (fr: string, en: string) => string
const KIND: Record<string, string> = { claude: 'Claude', codex: 'Codex' }
const kindName = (k: string | null) => (k && KIND[k]) || (k ? k[0]!.toUpperCase() + k.slice(1) : 'Shell')

export interface CloseTarget {
  kind: 'tab' | 'workspace'
  label: string
  panes: Pane[]
  // Tab: last of its space (Herdr then closes the space too).
  lastTab?: boolean
  workspaceLabel?: string
}

export function closeConfirm(x: CloseTarget, tl: Tl): { message: string, action: string } {
  const s = closeSummary(x.panes)
  const what = x.kind === 'tab' ? tl(`l’onglet «\u00a0${x.label}\u00a0»`, `tab “${x.label}”`) : tl(`l’espace «\u00a0${x.label}\u00a0»`, `space “${x.label}”`)
  const parts = [tl(`Fermer ${what}\u00a0?`, `Close ${what}?`)]
  if (x.kind === 'tab' && x.lastTab && x.workspaceLabel) {
    parts.push(tl(`C’est son dernier onglet\u00a0: l’espace «\u00a0${x.workspaceLabel}\u00a0» sera fermé aussi.`, `It is its last tab: space “${x.workspaceLabel}” will close too.`))
  }
  const n = s.agents.length
  if (n) {
    const names = s.agents.slice(0, 3).map(p => `${kindName(p.agent)}\u00a0«\u00a0${paneTitle(p)}\u00a0»`)
    const namesEn = s.agents.slice(0, 3).map(p => `${kindName(p.agent)} “${paneTitle(p)}”`)
    const more = n > 3 ? tl(` et ${n - 3} autre${n - 3 > 1 ? 's' : ''}`, ` and ${n - 3} more`) : ''
    parts.push(n === 1
      ? tl(`Un agent y tourne\u00a0: ${names[0]}. Il sera arrêté.`, `An agent is running there: ${namesEn[0]}. It will be stopped.`)
      : tl(`${n} agents y tournent\u00a0: ${names.join(', ')}${more}. Ils seront arrêtés.`, `${n} agents are running there: ${namesEn.join(', ')}${more}. They will be stopped.`))
  }
  if (s.shells === 1) parts.push(n ? tl('Son terminal sera fermé aussi.', 'Its terminal will close too.') : tl('Son terminal sera fermé.', 'Its terminal will close.'))
  else if (s.shells > 1) parts.push(n ? tl(`Ses ${s.shells} terminaux seront fermés aussi.`, `Its ${s.shells} terminals will close too.`) : tl(`Ses ${s.shells} terminaux seront fermés.`, `Its ${s.shells} terminals will close.`))
  const action = n
    ? tl(`Fermer et arrêter ${n > 1 ? `${n} agents` : 'l’agent'}`, `Close and stop ${n > 1 ? `${n} agents` : 'the agent'}`)
    : x.kind === 'tab' ? tl('Fermer l’onglet', 'Close tab') : tl('Fermer l’espace', 'Close space')
  return { message: parts.join(' '), action }
}
