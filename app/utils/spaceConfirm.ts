// Texte de confirmation avant de fermer un onglet ou un espace : ce qui sera
// arrêté (agents nommés, terminaux), et l'espace qui part avec son dernier
// onglet. Pur (testé) : la langue arrive avec `tl`.
import type { Pane } from '../../shared/types'
import { closeSummary } from '../../shared/spaceActions'
import { paneTitle } from '../../shared/paneTitle'

type Tl = (en: string, fr: string) => string
const KIND: Record<string, string> = { claude: 'Claude', codex: 'Codex' }
const kindName = (k: string | null) => (k && KIND[k]) || (k ? k[0]!.toUpperCase() + k.slice(1) : 'Shell')

export interface CloseTarget {
  kind: 'tab' | 'workspace'
  label: string
  panes: Pane[]
  // Onglet : dernier de son espace (Herdr ferme alors l'espace aussi).
  lastTab?: boolean
  workspaceLabel?: string
}

export function closeConfirm(x: CloseTarget, tl: Tl): { message: string, action: string } {
  const s = closeSummary(x.panes)
  const what = x.kind === 'tab' ? tl(`tab “${x.label}”`, `l’onglet «\u00a0${x.label}\u00a0»`) : tl(`space “${x.label}”`, `l’espace «\u00a0${x.label}\u00a0»`)
  const parts = [tl(`Close ${what}?`, `Fermer ${what}\u00a0?`)]
  if (x.kind === 'tab' && x.lastTab && x.workspaceLabel) {
    parts.push(tl(`It is its last tab: space “${x.workspaceLabel}” will close too.`, `C’est son dernier onglet\u00a0: l’espace «\u00a0${x.workspaceLabel}\u00a0» sera fermé aussi.`))
  }
  const n = s.agents.length
  if (n) {
    const names = s.agents.slice(0, 3).map(p => `${kindName(p.agent)}\u00a0«\u00a0${paneTitle(p)}\u00a0»`)
    const namesEn = s.agents.slice(0, 3).map(p => `${kindName(p.agent)} “${paneTitle(p)}”`)
    const more = n > 3 ? tl(` and ${n - 3} more`, ` et ${n - 3} autre${n - 3 > 1 ? 's' : ''}`) : ''
    parts.push(n === 1
      ? tl(`An agent is running there: ${namesEn[0]}. It will be stopped.`, `Un agent y tourne\u00a0: ${names[0]}. Il sera arrêté.`)
      : tl(`${n} agents are running there: ${namesEn.join(', ')}${more}. They will be stopped.`, `${n} agents y tournent\u00a0: ${names.join(', ')}${more}. Ils seront arrêtés.`))
  }
  if (s.shells === 1) parts.push(n ? tl('Its terminal will close too.', 'Son terminal sera fermé aussi.') : tl('Its terminal will close.', 'Son terminal sera fermé.'))
  else if (s.shells > 1) parts.push(n ? tl(`Its ${s.shells} terminals will close too.`, `Ses ${s.shells} terminaux seront fermés aussi.`) : tl(`Its ${s.shells} terminals will close.`, `Ses ${s.shells} terminaux seront fermés.`))
  const action = n
    ? tl(`Close and stop ${n > 1 ? `${n} agents` : 'the agent'}`, `Fermer et arrêter ${n > 1 ? `${n} agents` : 'l’agent'}`)
    : x.kind === 'tab' ? tl('Close tab', 'Fermer l’onglet') : tl('Close space', 'Fermer l’espace')
  return { message: parts.join(' '), action }
}
