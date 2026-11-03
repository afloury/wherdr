// Foreground process of a pane, independent of the server state: Herdr calls
// injected (tests).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any
export interface RestartDeps {
  call: (method: string, params: Record<string, unknown>, timeoutMs?: number) => Promise<Json>
  sleep: (ms: number) => Promise<void>
  now: () => number
}

const base = (s: string) => s.replace(/^.*\//, '').replace(/\.(c?js|mjs)$/, '')

// Foreground process of the pane: the shell (at its prompt) or the agent.
export async function paneForeground(d: RestartDeps, paneId: string, kind: string) {
  const r = await d.call('pane.process_info', { pane_id: paneId }, 4000)
  const info = (r && r.process_info) || {}
  const procs: Json[] = info.foreground_processes || []
  const agent = procs.find(p => p.name === kind || (p.argv || []).some((a: string) => base(a) === kind)) || null
  // Foreground group = the shell's: nothing runs on top of it any more.
  const atShell = !agent && Boolean(info.shell_pid) && info.foreground_process_group_id === info.shell_pid
  // The pane's shell (agent typed at its prompt) and its name, known at its prompt.
  const sh = procs.find(p => info.shell_pid && p.pid === info.shell_pid)
  const shell = { pid: Number(info.shell_pid) || null, name: sh ? String(sh.name || (sh.argv || [])[0] || '') || null : null }
  return { agent, atShell, shell, argv: agent && Array.isArray(agent.argv) ? agent.argv.map(String) as string[] : null }
}
