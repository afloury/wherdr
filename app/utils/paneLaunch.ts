// « Nouvel onglet » et « Diviser » : rien n'est créé tant que la feuille n'est
// pas confirmée. Au clic sur « Lancer » : l'onglet (nom saisi) ou la division
// du pane (sens choisi, ratio par défaut de Herdr), dans le dossier choisi,
// puis l'agent ou le terminal dans le nouveau pane. Pur (appels injectés, testé).
import { AGENT_NAME_HINT, AGENT_NAME_RE } from '../../shared/ids'
import { type SplitDirection, cleanLabel } from '../../shared/spaceActions'

// Où naît le pane : un nouvel onglet de l'espace, ou la division d'un pane.
export type NewPanePlace =
  | { kind: 'tab', workspaceId: string, label: string }
  | { kind: 'split', paneId: string, direction: SplitDirection }

export interface NewPaneRequest {
  place: NewPanePlace
  cwd: string | null
  // Corps de /api/agents sans le pane (kind, prompt, name, resume…).
  agent: Record<string, unknown>
}
export interface NewPaneDeps {
  space: (body: Record<string, unknown>) => Promise<{ tab_id?: string, pane_id?: string }>
  agents: (body: Record<string, unknown>) => Promise<{ pane_id: string }>
}
// `create` : ni onglet ni pane créé (on reste sur la feuille) ; `agent` : le
// pane existe (son terminal reste) mais l'agent n'a pas démarré.
export type NewPaneOutcome =
  | { stage: 'create', error: string }
  | { stage: 'agent', tabId?: string, paneId?: string, error: string }
  | { stage: 'done', tabId?: string, paneId: string }

// Appel /api/space qui crée le pane. Dossier transmis à Herdr seulement s'il
// est absolu (sinon celui de Herdr).
export function createPaneBody(place: NewPanePlace, cwd: string | null): Record<string, unknown> {
  const at = cwd && cwd.startsWith('/') ? { cwd } : {}
  if (place.kind === 'split') return { op: 'pane.split', pane_id: place.paneId, direction: place.direction, ...at }
  const label = cleanLabel(place.label)
  return { op: 'tab.create', workspace_id: place.workspaceId, ...(label ? { label } : {}), ...at }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export async function launchInNewPane(deps: NewPaneDeps, req: NewPaneRequest): Promise<NewPaneOutcome> {
  // Erreur prévisible (nom d'agent invalide) : signalée avant de créer quoi que ce soit.
  const name = String(req.agent.name || '').trim().toLowerCase()
  if (name && !AGENT_NAME_RE.test(name)) return { stage: 'create', error: AGENT_NAME_HINT }
  let created: { tab_id?: string, pane_id?: string }
  try { created = await deps.space(createPaneBody(req.place, req.cwd)) }
  catch (e) { return { stage: 'create', error: message(e) } }
  const tabId = created.tab_id
  const paneId = created.pane_id
  if (!paneId) return { stage: 'agent', tabId, error: 'Pane not found' }
  try {
    const r = await deps.agents({ ...req.agent, pane_id: paneId, cwd: req.cwd, worktree: false })
    return { stage: 'done', tabId, paneId: r.pane_id || paneId }
  } catch (e) {
    return { stage: 'agent', tabId, paneId, error: message(e) }
  }
}
