// Restart an agent in its pane (same tab, layout and folder) while
// resuming its conversation, see shared/restart.ts for the choice of command.
// Sequence (restartSeq.ts): read the original command line, quit
// cleanly (`/exit`, otherwise Ctrl+C ×2), wait for the return to the shell, then
// `agent.start` with `--resume <id>`. Everything goes through the pane's Herdr API
// (send_input, process_info, agent.start): same path for a remote machine.
import type { Pane } from '../../shared/types'
import { type CurrentSettings, type RestartPlan, RESTARTABLE, claudeFooterMode, planRestart } from '../../shared/restart'
import { HerdrError, herdr, sleep } from './herdr'
import { findPane, poll, restarts, transcripts } from './state'
import { type RestartDeps, paneForeground, startAgent, stopAgent } from './restartSeq'
import { checkTerminalUpdate, updateInTerminal } from './codexTermUpdate'
import { withPaneLock } from './guardedSend'
import { log } from './env'

const defaultDeps: RestartDeps = { call: (m, params, t) => herdr(m, params, t), sleep, now: Date.now }

// Relaunch plan of a pane: original command line and conversation.
export async function restartPlanFor(p: Pane, d: RestartDeps = defaultDeps): Promise<RestartPlan> {
  if (!p.agent || !RESTARTABLE.has(p.agent)) throw new HerdrError('restart_unsupported', 'agent not supported')
  let argv: string[] | null = null
  try { argv = (await paneForeground(d, p.id, p.agent)).argv }
  catch { argv = null }
  let session: string | null = null
  try { session = (await transcripts.locate(p))?.session || null }
  catch { session = null }
  // Claude: effort and permission mode in effect (not restored by --resume).
  const current: CurrentSettings = {}
  if (p.agent === 'claude') {
    current.effort = p.model?.effort || null
    // In front of a question, the field (and its mode) is not shown.
    if (p.status !== 'blocked') {
      try { current.permissionMode = claudeFooterMode((await d.call('pane.read', { pane_id: p.id, source: 'visible' }, 4000))?.read?.text) }
      catch { /* unknown mode: the command line's */ }
    }
  }
  return planRestart({ kind: p.agent, argv, session, hadSession: Boolean(p.agentSession), current })
}

// Panes whose relaunch plan is being read: `restarts` is only
// filled afterwards, a double tap would otherwise start two sequences.
const planning = new Set<string>()

// Starts the restart in the background; the state is published in `pane.restart`.
export async function restartAgent(paneId: string) {
  const p = findPane(paneId)
  if (!p || !p.agent) throw new HerdrError('bad_pane', 'agent not found')
  const cur = restarts.get(paneId)
  if (planning.has(paneId) || (cur && cur.phase !== 'failed')) throw new HerdrError('restart_busy', 'restart already in progress')
  planning.add(paneId)
  let plan: RestartPlan
  try { plan = await restartPlanFor(p) }
  finally { planning.delete(paneId) }
  const snap = { id: p.id, agent: p.agent, status: p.status, name: p.name }
  const session = p.agentSession
  restarts.set(paneId, { phase: 'stopping', agent: p.agent, session, at: Date.now() })
  poll()
  // Under the pane's send lock (guardedSend.ts): no message of wherdr's is
  // typed between /exit and the new agent.
  void withPaneLock(paneId, async () => {
    let stopped = false
    try {
      await stopAgent(defaultDeps, snap)
      stopped = true
      restarts.set(paneId, { phase: 'starting', agent: snap.agent, session, at: Date.now() })
      poll()
      await startAgent(defaultDeps, snap, plan)
      // Herdr's state may only show the agent a moment later: the
      // progress stays displayed until then (cleared by state.ts).
      restarts.set(paneId, { phase: 'starting', agent: snap.agent, session, at: Date.now(), started: true })
      log(`agent ${snap.agent} restarted (${plan.mode}) in ${paneId}`)
    } catch (e) {
      restarts.set(paneId, { phase: 'failed', agent: snap.agent, session, at: Date.now(), stopped, error: (e as Error).message })
      log(`restart of ${paneId} failed: ${(e as Error).message}`)
    }
    poll()
  })
  return plan
}

// Codex update in its own terminal (see codexTermUpdate.ts), shown like a
// restart with one more step: "Exiting Codex… / Updating… / Restarting…".
// The checks (Codex idle, at its field, started from a shell) are awaited:
// a refusal reaches the caller; `done` settles at the end of the sequence.
export async function updateCodexInPane(paneId: string, command: string): Promise<{ done: Promise<void> }> {
  const p = findPane(paneId)
  if (!p || p.agent !== 'codex') throw new HerdrError('bad_pane', 'agent not found')
  const cur = restarts.get(paneId)
  if (planning.has(paneId) || (cur && cur.phase !== 'failed')) throw new HerdrError('restart_busy', 'restart already in progress')
  planning.add(paneId)
  let plan: RestartPlan
  try {
    await checkTerminalUpdate(defaultDeps, p)
    plan = await restartPlanFor(p)
  } finally { planning.delete(paneId) }
  const snap = { id: p.id, agent: p.agent, status: p.status, name: p.name }
  const session = p.agentSession
  const set = (phase: NonNullable<Pane['restart']>['phase'], more: { stopped?: boolean, started?: boolean, error?: string } = {}) => {
    restarts.set(paneId, { phase, agent: 'codex', session, at: Date.now(), update: command, ...more })
    poll()
  }
  set('stopping')
  log(`codex update in ${paneId}: ${command}`)
  let stopped = false
  // Under the pane's send lock, like a restart: nothing typed into the shell.
  const done = withPaneLock(paneId, () => updateInTerminal({
    ...defaultDeps,
    phase: (ph) => {
      if (ph !== 'stopping') stopped = true
      set(ph)
    },
  }, snap, plan, command)).then(() => {
    set('starting', { started: true })
    log(`codex updated and restarted (${plan.mode}) in ${paneId}`)
  }, (e: Error) => {
    set('failed', { stopped, error: e.message })
    log(`codex update in ${paneId} failed: ${e.message}`)
    throw e
  })
  return { done }
}

export function dismissRestart(paneId: string) {
  if (restarts.get(paneId)?.phase === 'failed') restarts.delete(paneId)
  poll()
}
