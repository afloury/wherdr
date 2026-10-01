// Herdr's `session.snapshot` reduced to what the app shows: workspaces,
// tabs (and their layout), panes. Pure: no state or disk access.
// We remove the fields that change with every output byte (revision, scroll…)
// so only real changes are pushed.
import type { HerdrState, Pane, Tab, Workspace } from '../../shared/types'
import { LOCAL, joinId } from '../../shared/ids'
import { reduceLayout } from '../../shared/layout'
import { paneAgentKind } from '../../shared/agentKind'
import { projectToken } from '../../shared/projects'
import { cleanLabel } from '../../shared/displayTitles'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

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
      // Tokens set by the herdr-projects plugin on its panes.
      ...(projectToken(p.tokens) ? { project: projectToken(p.tokens) } : {}),
      ...(Number.isFinite(p.state_change_seq) ? { stateSeq: Number(p.state_change_seq) } : {}),
    }
  })
  return { ok: true, version: s.version, session: machine ? undefined : session, workspaces, tabs, panes }
}

const SHELL_NAMES = new Set(['sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'tcsh', 'csh', 'nu', 'pwsh', 'login'])
// `pane.process_info`: foreground command ("pnpm dev"), empty when the
// shell is waiting at the prompt. Executable path reduced to its name, 60 characters max.
export function foregroundCommand(info: Json): string {
  const procs: Json[] = (info && info.foreground_processes) || []
  const p = procs.find(x => x && x.pid !== info.shell_pid) || procs[0]
  if (!p || p.pid === info.shell_pid) return ''
  const argv: string[] = Array.isArray(p.argv) && p.argv.length ? p.argv.map(String) : String(p.cmdline || p.name || '').split(/\s+/)
  const name = (argv[0] || '').split('/').pop()!.replace(/^-/, '')
  if (!name || SHELL_NAMES.has(name)) return ''
  return [name, ...argv.slice(1)].join(' ').replace(/\s+/g, ' ').trim().slice(0, 60)
}
