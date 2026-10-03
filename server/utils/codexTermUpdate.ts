// Codex update typed into the agent's own terminal (method `terminal` of
// shared/codexStatus.ts), for a wherdr that cannot run it itself (Docker,
// read-only home): the pane's shell runs on the agent's machine with the
// user's rights. Sequence, independent of the server state (Herdr calls
// injected, tests): quit Codex like a restart (`/exit`, restartSeq.ts), type
// the known official command followed by an end marker at the shell prompt,
// wait for the marker and its exit status, then `agent.start` with
// `codex resume <id>` (same conversation, Herdr tracks the agent again).
// On failure the pane stays at its shell, the command there to see.
import crypto from 'node:crypto'
import type { Pane } from '../../shared/types'
import type { RestartPlan } from '../../shared/restart'
import { codexMenuOpen, terminalUpdateDone, terminalUpdateLine } from '../../shared/codexStatus'
import { HerdrError } from './herdr'
import { type RestartDeps, paneForeground, startAgent, stopAgent, waitFor } from './restartSeq'

export type TermUpdatePhase = 'stopping' | 'updating' | 'starting'
export interface TermUpdateDeps extends RestartDeps {
  phase: (phase: TermUpdatePhase) => void
  nonce?: () => string
}
type Agent = Pick<Pane, 'id' | 'agent' | 'status' | 'name'>

// Longest wait for the installer (download included).
export const TERM_UPDATE_MS = 10 * 60000
const READ_LINES = 400

const readRecent = async (d: RestartDeps, paneId: string) => {
  const r = await d.call('pane.read', { pane_id: paneId, source: 'recent_unwrapped', lines: READ_LINES }, 4000)
  return String((r && r.read && r.read.text) || '')
}

// Checks done before anything is typed (refusal shown right away): Codex
// idle, at its input field, started from a shell that will stay.
export async function checkTerminalUpdate(d: RestartDeps, p: Agent) {
  if (p.agent !== 'codex') throw new HerdrError('bad_pane', 'agent not found')
  if (p.status === 'working' || p.status === 'blocked') throw new HerdrError('agent_busy', 'Codex is working or waiting for an answer: update it once it is done')
  const fg = await paneForeground(d, p.id, 'codex')
  if (!fg.agent) throw new HerdrError('update_no_agent', 'Codex is not running in this pane')
  if (!fg.shell.pid) throw new HerdrError('update_no_shell', 'Codex was not started from a shell: quitting it would close the pane')
  const r = await d.call('pane.read', { pane_id: p.id, source: 'visible' }, 4000)
  if (codexMenuOpen(r && r.read && r.read.text)) throw new HerdrError('update_menu', 'Codex is showing a menu: answer it first')
}

export async function updateInTerminal(d: TermUpdateDeps, p: Agent, plan: RestartPlan, command: string) {
  const nonce = (d.nonce || (() => crypto.randomBytes(6).toString('hex')))()
  d.phase('stopping')
  await stopAgent(d, p)
  const fg = await paneForeground(d, p.id, 'codex')
  const line = terminalUpdateLine(command, nonce, fg.shell.name)
  if (!line) throw new HerdrError('update_shell', `Unsupported shell (${fg.shell.name || 'unknown'}): run the command yourself`)
  d.phase('updating')
  await d.call('pane.send_input', { pane_id: p.id, text: line })
  await d.sleep(300)
  await d.call('pane.send_input', { pane_id: p.id, keys: ['enter'] })
  const result: { end: ReturnType<typeof terminalUpdateDone> } = { end: null }
  await waitFor(d, TERM_UPDATE_MS, async () => Boolean(result.end = terminalUpdateDone(await readRecent(d, p.id), nonce)))
  const end = result.end
  if (!end) throw new HerdrError('update_timeout', 'The update did not finish in 10 minutes: see the terminal')
  if (end.code !== 0) throw new HerdrError('update_failed', `The update command failed (exit ${end.code})${end.last ? `: ${end.last}` : ''}`)
  // The marker is printed by the shell itself: its prompt follows.
  await waitFor(d, 5000, async () => (await paneForeground(d, p.id, 'codex')).atShell)
  d.phase('starting')
  await startAgent(d, p, plan)
}
