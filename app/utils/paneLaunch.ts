// "New tab" and "Split": nothing is created until the sheet is
// confirmed. On clicking "Launch": the tab (typed name) or the split
// of the pane (chosen direction, Herdr's default ratio), in the chosen folder,
// then the agent or the terminal in the new pane. Pure (calls injected, tested).
import { AGENT_NAME_HINT, AGENT_NAME_RE } from '../../shared/ids'
import { type SplitDirection, cleanLabel } from '../../shared/spaceActions'

// Where the pane is born: a new tab of the space, or the split of a pane.
export type NewPanePlace =
  | { kind: 'tab', workspaceId: string, label: string }
  | { kind: 'split', paneId: string, direction: SplitDirection }

export interface NewPaneRequest {
  place: NewPanePlace
  cwd: string | null
  // Body of /api/agents without the pane (kind, prompt, name, resume…).
  agent: Record<string, unknown>
}
export interface NewPaneDeps {
  space: (body: Record<string, unknown>) => Promise<{ tab_id?: string, pane_id?: string }>
  agents: (body: Record<string, unknown>) => Promise<{ pane_id: string }>
}
// `create`: neither tab nor pane created (we stay on the sheet); `agent`: the
// pane exists (its terminal stays) but the agent did not start.
export type NewPaneOutcome =
  | { stage: 'create', error: string }
  | { stage: 'agent', tabId?: string, paneId?: string, error: string }
  | { stage: 'done', tabId?: string, paneId: string }

// /api/space call that creates the pane. Folder passed to Herdr only if it
// is absolute (otherwise Herdr's).
export function createPaneBody(place: NewPanePlace, cwd: string | null): Record<string, unknown> {
  const at = cwd && cwd.startsWith('/') ? { cwd } : {}
  if (place.kind === 'split') return { op: 'pane.split', pane_id: place.paneId, direction: place.direction, ...at }
  const label = cleanLabel(place.label)
  return { op: 'tab.create', workspace_id: place.workspaceId, ...(label ? { label } : {}), ...at }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export async function launchInNewPane(deps: NewPaneDeps, req: NewPaneRequest): Promise<NewPaneOutcome> {
  // Predictable error (invalid agent name): reported before creating anything.
  const name = String(req.agent.name || '').trim().toLowerCase()
  if (name && !AGENT_NAME_RE.test(name)) return { stage: 'create', error: AGENT_NAME_HINT }
  let created: { tab_id?: string, pane_id?: string }
  try { created = await deps.space(createPaneBody(req.place, req.cwd)) }
  catch (e) { return { stage: 'create', error: message(e) } }
  const tabId = created.tab_id
  const paneId = created.pane_id
  if (!paneId) return { stage: 'agent', tabId, error: 'pane introuvable' }
  try {
    const r = await deps.agents({ ...req.agent, pane_id: paneId, cwd: req.cwd, worktree: false })
    return { stage: 'done', tabId, paneId: r.pane_id || paneId }
  } catch (e) {
    return { stage: 'agent', tabId, paneId, error: message(e) }
  }
}
