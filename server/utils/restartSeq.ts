// Séquence de redémarrage d'un agent (arrêt puis relance dans le même pane),
// sans dépendance à l'état du serveur : appels Herdr injectés (tests).
import crypto from 'node:crypto'
import type { Pane } from '../../shared/types'
import type { RestartPlan } from '../../shared/restart'
import { HerdrError } from './herdr'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any
export interface RestartDeps {
  call: (method: string, params: Record<string, unknown>, timeoutMs?: number) => Promise<Json>
  sleep: (ms: number) => Promise<void>
  now: () => number
}

const base = (s: string) => s.replace(/^.*\//, '').replace(/\.(c?js|mjs)$/, '')

// Processus au premier plan du pane : le shell (à son invite) ou l'agent.
export async function paneForeground(d: RestartDeps, paneId: string, kind: string) {
  const r = await d.call('pane.process_info', { pane_id: paneId }, 4000)
  const info = (r && r.process_info) || {}
  const procs: Json[] = info.foreground_processes || []
  const agent = procs.find(p => p.name === kind || (p.argv || []).some((a: string) => base(a) === kind)) || null
  // Groupe au premier plan = celui du shell : plus rien ne tourne par-dessus.
  const atShell = !agent && Boolean(info.shell_pid) && info.foreground_process_group_id === info.shell_pid
  return { agent, atShell, argv: agent && Array.isArray(agent.argv) ? agent.argv.map(String) as string[] : null }
}

async function waitFor(d: RestartDeps, ms: number, test: () => Promise<boolean>) {
  const end = d.now() + ms
  while (d.now() < end) {
    await d.sleep(500)
    try { if (await test()) return true }
    catch { /* pane en transition */ }
  }
  return false
}
const waitShell = (d: RestartDeps, paneId: string, kind: string, ms: number) =>
  waitFor(d, ms, async () => (await paneForeground(d, paneId, kind)).atShell)
const busy = async (d: RestartDeps, paneId: string) => {
  const r = await d.call('pane.get', { pane_id: paneId }, 4000)
  const s = r && r.pane && r.pane.agent_status
  return s === 'working' || s === 'blocked'
}

// Quitter l'agent. Au travail ou devant une question : Échap d'abord (interrompt
// le tour, refuse la permission), sinon `/exit` serait tapé dans la réponse. Un
// seul Échap à la fois : deux de suite sur un champ vide ouvrent le retour en
// arrière de Claude.
export async function stopAgent(d: RestartDeps, p: Pick<Pane, 'id' | 'agent' | 'status'>) {
  const kind = p.agent!
  const key = (k: string) => d.call('pane.send_input', { pane_id: p.id, keys: [k] })
  if (p.status === 'working' || p.status === 'blocked') {
    for (let i = 0; i < 2; i++) {
      await key('esc')
      if (await waitFor(d, 3000, async () => !(await busy(d, p.id)))) break
    }
  }
  await d.call('pane.send_input', { pane_id: p.id, text: '/exit' })
  await d.sleep(300)
  await key('enter')
  if (await waitShell(d, p.id, kind, 8000)) return 'exit'
  await key('ctrl+c')
  await d.sleep(400)
  await key('ctrl+c')
  if (await waitShell(d, p.id, kind, 6000)) return 'ctrl-c'
  throw new HerdrError('restart_stop', 'l’agent ne s’est pas arrêté')
}

// Relancer l'agent (le shell peut mettre un instant à afficher son invite).
export async function startAgent(d: RestartDeps, p: Pick<Pane, 'id' | 'agent' | 'name'>, plan: RestartPlan) {
  const name = p.name || `${p.agent}-${crypto.randomBytes(2).toString('hex')}`
  let last: HerdrError | null = null
  for (let i = 0; i < 6; i++) {
    try {
      await d.call('agent.start', { name, kind: p.agent, pane_id: p.id, timeout_ms: 60000, ...(plan.args.length ? { args: plan.args } : {}) }, 75000)
      return
    } catch (e) {
      last = e as HerdrError
      if (last.code === 'agent_not_ready') return // démarré, arrêté sur une invite
      if (last.code === 'timeout' || last.code === 'unreachable') break
      await d.sleep(500)
    }
  }
  throw last || new HerdrError('restart_start', 'l’agent n’a pas redémarré')
}
