// Redémarrer un agent dans son pane (même onglet, disposition et dossier) en
// reprenant sa conversation, cf. shared/restart.ts pour le choix de la commande.
// Séquence (restartSeq.ts) : lire la ligne de commande d'origine, quitter
// proprement (`/exit`, sinon Ctrl+C ×2), attendre le retour au shell, puis
// `agent.start` avec `--resume <id>`. Tout passe par l'API Herdr du pane
// (send_input, process_info, agent.start) : même chemin pour une machine distante.
import type { Pane } from '../../shared/types'
import { type CurrentSettings, type RestartPlan, RESTARTABLE, claudeFooterMode, planRestart } from '../../shared/restart'
import { HerdrError, herdr, sleep } from './herdr'
import { findPane, poll, restarts, transcripts } from './state'
import { type RestartDeps, paneForeground, startAgent, stopAgent } from './restartSeq'
import { log } from './env'

const defaultDeps: RestartDeps = { call: (m, params, t) => herdr(m, params, t), sleep, now: Date.now }

// Plan de relance d'un pane : ligne de commande d'origine et conversation.
export async function restartPlanFor(p: Pane, d: RestartDeps = defaultDeps): Promise<RestartPlan> {
  if (!p.agent || !RESTARTABLE.has(p.agent)) throw new HerdrError('restart_unsupported', 'agent not supported')
  let argv: string[] | null = null
  try { argv = (await paneForeground(d, p.id, p.agent)).argv }
  catch { argv = null }
  let session: string | null = null
  try { session = (await transcripts.locate(p))?.session || null }
  catch { session = null }
  // Claude : effort et mode de permission en service (non restaurés par --resume).
  const current: CurrentSettings = {}
  if (p.agent === 'claude') {
    current.effort = p.model?.effort || null
    // Devant une question, le champ (et son mode) n'est pas affiché.
    if (p.status !== 'blocked') {
      try { current.permissionMode = claudeFooterMode((await d.call('pane.read', { pane_id: p.id, source: 'visible' }, 4000))?.read?.text) }
      catch { /* mode inconnu : celui de la ligne de commande */ }
    }
  }
  return planRestart({ kind: p.agent, argv, session, hadSession: Boolean(p.agentSession), current })
}

// Panes dont le plan de relance est en cours de lecture : `restarts` n'est
// rempli qu'après, un double toucher lancerait sinon deux séquences.
const planning = new Set<string>()

// Lance le redémarrage en tâche de fond ; l'état est publié dans `pane.restart`.
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
  void (async () => {
    let stopped = false
    try {
      await stopAgent(defaultDeps, snap)
      stopped = true
      restarts.set(paneId, { phase: 'starting', agent: snap.agent, session, at: Date.now() })
      poll()
      await startAgent(defaultDeps, snap, plan)
      // L'état de Herdr peut ne montrer l'agent qu'un instant plus tard : le
      // suivi reste affiché jusque-là (effacé par state.ts).
      restarts.set(paneId, { phase: 'starting', agent: snap.agent, session, at: Date.now(), started: true })
      log(`agent ${snap.agent} redémarré (${plan.mode}) dans ${paneId}`)
    } catch (e) {
      restarts.set(paneId, { phase: 'failed', agent: snap.agent, session, at: Date.now(), stopped, error: (e as Error).message })
      log(`redémarrage de ${paneId} échoué : ${(e as Error).message}`)
    }
    poll()
  })()
  return plan
}

export function dismissRestart(paneId: string) {
  if (restarts.get(paneId)?.phase === 'failed') restarts.delete(paneId)
  poll()
}
