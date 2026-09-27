// `session.snapshot` de Herdr réduit à ce que l'app affiche : workspaces,
// onglets (et leur disposition), panes. Pur : sans état ni accès au disque.
// On retire les champs qui bougent à chaque octet de sortie (revision, scroll…)
// pour ne pousser que les vrais changements.
import type { HerdrState, Pane, Tab, Workspace } from '../../shared/types'
import { LOCAL, joinId } from '../../shared/ids'
import { reduceLayout } from '../../shared/layout'
import { paneAgentKind } from '../../shared/agentKind'
import { projectToken } from '../../shared/projects'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

// `machine` : clé de la machine distante (IDs préfixés), '' pour la locale ;
// `session` : nom de la session Herdr locale affichée.
export function reduceSnapshot(s: Json, machine = LOCAL, session = 'default'): HerdrState {
  const id = (x: unknown) => (x == null ? x : joinId(machine, String(x))) as string
  const mk = machine ? { machine } : {}
  const workspaces: Workspace[] = (s.workspaces || []).map((w: Json) => ({
    id: id(w.workspace_id), ...mk, label: w.label, number: w.number, status: w.agent_status,
    // Workspace ouvert sur un worktree Git (créé par Herdr, souvent une branche d'agent).
    worktree: Boolean(w.worktree && w.worktree.is_linked_worktree),
    ...(w.worktree && w.worktree.repo_key ? { repo: String(w.worktree.repo_key), repoName: String(w.worktree.repo_name || '') } : {}),
  }))
  const layouts = new Map<string, Json>((s.layouts || []).filter((l: Json) => l && l.tab_id).map((l: Json) => [String(l.tab_id), l]))
  const tabs: Tab[] = (s.tabs || []).filter((t: Json) => t && t.tab_id).map((t: Json) => ({
    id: id(t.tab_id),
    ...mk,
    workspace: id(t.workspace_id),
    label: String(t.label ?? t.number ?? ''),
    number: Number(t.number) || 0,
    layout: reduceLayout(layouts.get(String(t.tab_id)), x => joinId(machine, x)),
  }))
  const tabLabels: Record<string, string> = Object.fromEntries((s.tabs || []).map((t: Json) => [t.tab_id, t.label]))
  // `agents` porte le nom et voit un agent dès son lancement (launch_pending),
  // avant que `panes` ne le rattache : on superpose l'un à l'autre.
  const agents = Object.fromEntries((s.agents || []).map((a: Json) => [a.pane_id, a]))
  const panes: Pane[] = (s.panes || []).map((raw: Json) => {
    const p = { ...raw, ...(agents[raw.pane_id] || {}) }
    p.agent = paneAgentKind(raw, agents[raw.pane_id])
    return {
      id: id(p.pane_id),
      ...mk,
      workspace: id(p.workspace_id),
      tab: id(p.tab_id),
      tabLabel: tabLabels[p.tab_id] ?? null,
      agent: p.agent || null,
      name: p.name || null,
      // Nom choisi par l'utilisateur (pane.rename), aussi affiché dans le client herdr.
      label: p.label || null,
      status: p.agent ? p.agent_status : null,
      title: p.terminal_title_stripped || p.terminal_title || null,
      cwd: p.foreground_cwd || p.cwd || null,
      // Identifiant de session transmis par l'intégration Herdr de l'agent
      // (herdr integration install codex) : désigne exactement sa transcription.
      agentSession: p.agent_session && p.agent_session.value ? p.agent_session.value : null,
      // Jetons posés par le plugin herdr-projects sur ses panes.
      ...(projectToken(p.tokens) ? { project: projectToken(p.tokens) } : {}),
    }
  })
  return { ok: true, version: s.version, session: machine ? undefined : session, workspaces, tabs, panes }
}
