// Test helper: a Herdr `session.snapshot` (tests/fixtures/snapshot-layouts.json)
// reduced to the app's state (workspaces, tabs and their layout, panes), as the
// former Herdr backend did. Builds the input of the layout, spaces and workspaces tests.
import type { HerdrState, Pane, Tab, Workspace } from '../../shared/types'
import { LOCAL, SEP } from '../../shared/ids'
import { reduceLayout } from '../../shared/layout'
import { paneAgentKind } from '../../shared/agentKind'
import { cleanLabel } from '../../shared/displayTitles'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any
const joinId = (machine: string, local: string) => (machine ? `${machine}${SEP}${local}` : local)

// `machine`: key of the remote machine (prefixed IDs), '' for the local one;
// `session`: name of the local Herdr session shown.
export function reduceSnapshot(s: Json, machine = LOCAL, session = 'default'): HerdrState {
  const id = (x: unknown) => (x == null ? x : joinId(machine, String(x))) as string
  const mk = machine ? { machine } : {}
  const workspaces: Workspace[] = (s.workspaces || []).map((w: Json) => ({
    id: id(w.workspace_id), ...mk, label: cleanLabel(w.label), number: w.number, status: w.agent_status,
    // Workspace open on a Git worktree (created by Herdr, often an agent branch).
    worktree: Boolean(w.worktree && w.worktree.is_linked_worktree),
    ...(w.worktree && w.worktree.repo_key ? { repo: String(w.worktree.repo_key), repoName: String(w.worktree.repo_name || '') } : {}),
    ...(w.worktree?.checkout_path ? { path: String(w.worktree.checkout_path) } : {}),
    ...(w.worktree?.branch ? { branch: String(w.worktree.branch) } : {}),
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
  // `agents` carries the name and sees an agent as soon as it is launched (launch_pending),
  // before `panes` attaches it: we overlay one on the other.
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
      // Name chosen by the user (pane.rename), also shown in the herdr client.
      label: cleanLabel(p.label) || null,
      ...(cleanLabel(p.display_agent) ? { displayAgent: cleanLabel(p.display_agent) } : {}),
      status: p.agent ? p.agent_status : null,
      title: p.terminal_title_stripped || p.terminal_title || null,
      cwd: p.foreground_cwd || p.cwd || null,
      // Session identifier passed by the agent's Herdr integration
      // (herdr integration install codex): designates exactly its transcript.
      agentSession: p.agent_session && p.agent_session.value ? p.agent_session.value : null,
      ...(Number.isFinite(p.state_change_seq) ? { stateSeq: Number(p.state_change_seq) } : {}),
    }
  })
  return { ok: true, version: s.version, session: machine ? undefined : session, workspaces, tabs, panes }
}
