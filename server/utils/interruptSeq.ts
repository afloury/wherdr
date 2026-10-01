// Stop button: interrupt the agent's turn, and check that it stops.
// Findings (Claude Code 2.1, Herdr test session):
// - thinking, tool, foreground Bash command: one Escape is enough;
// - command started in the background: Escape does not touch it, the agent goes
//   "idle" then resumes on its own when it finishes;
// - background subagent: Escape does nothing, the agent stays "working".
// Background tasks are stopped from the panel opened by ↓ ("x to stop").
// Never Ctrl+C: on the second one, Claude Code quits.
import type { Pane } from '../../shared/types'
import { nextBackgroundKey, parseBackground } from '../../shared/interrupt'
import type { RestartDeps } from './restartSeq'

export interface InterruptResult {
  stopped: boolean
  esc: number
  background: number
}

const status = async (d: RestartDeps, paneId: string) => {
  const r = await d.call('pane.get', { pane_id: paneId }, 4000)
  return (r && r.pane && r.pane.agent_status) as string | undefined
}
const screen = async (d: RestartDeps, paneId: string) =>
  parseBackground((await d.call('pane.read', { pane_id: paneId, source: 'visible' }, 4000))?.read?.text)

async function settle(d: RestartDeps, paneId: string, ms: number) {
  const end = d.now() + ms
  while (d.now() < end) {
    await d.sleep(400)
    try { if (await status(d, paneId) !== 'working') return true }
    catch { /* pane en transition */ }
  }
  return false
}

export async function interruptAgent(d: RestartDeps, p: Pick<Pane, 'id' | 'agent' | 'status'>): Promise<InterruptResult> {
  const key = (k: string) => d.call('pane.send_input', { pane_id: p.id, keys: [k] })
  const res: InterruptResult = { stopped: false, esc: 0, background: 0 }
  // 1. Escape, then a second one if the agent is still working (Claude Code and Codex
  //    interrupt on the first or second depending on the state). No second Escape
  //    on an agent already stopped: on an empty field, it would open rewind.
  for (let i = 0; i < 2; i++) {
    await key('esc')
    res.esc++
    if (await settle(d, p.id, 2500)) break
    // Only a background subagent keeps the agent working: Escape cannot help.
    if (p.agent === 'claude' && (await screen(d, p.id).catch(() => null))?.agents) break
  }
  // 2. Claude: stop background shells and subagents from their panel.
  if (p.agent === 'claude') {
    let opened = 0
    for (let step = 0; step < 16; step++) {
      const s = await screen(d, p.id).catch(() => null)
      if (!s) break
      const k = nextBackgroundKey(s, opened)
      if (!k) break
      if (k === 'down' && !s.panel) {
        // A subagent already stopped stays listed below the footer: we only open the list
        // for shells, or if the agent is still working.
        if (!s.shells && (await status(d, p.id).catch(() => 'working')) !== 'working') break
        opened++
        await key('down')
        await d.sleep(700)
        // Shells: ↓ selects the footer ("2 shells"), Enter opens the list.
        const after = await screen(d, p.id).catch(() => null)
        if (after && !after.panel) { await key('enter'); await d.sleep(700) }
        continue
      }
      await key(k)
      if (k === 'x') res.background++
      // An "x" chained too fast is ignored by Claude Code.
      await d.sleep(k === 'x' ? 1200 : 500)
      if (k === 'esc') break
    }
  }
  res.stopped = await settle(d, p.id, res.background ? 4000 : 1500)
  return res
}
