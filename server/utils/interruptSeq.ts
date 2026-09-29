// Bouton Stop : interrompre le tour de l'agent, et vérifier qu'il s'arrête.
// Constats (Claude Code 2.1, session Herdr de test) :
// - réflexion, outil, commande Bash au premier plan : un Échap suffit ;
// - commande lancée en arrière-plan : Échap ne la touche pas, l'agent passe
//   « idle » puis reprend tout seul quand elle se termine ;
// - sous-agent en arrière-plan : Échap ne fait rien, l'agent reste « working ».
// Les tâches de fond s'arrêtent depuis le panneau ouvert par ↓ (« x to stop »).
// Jamais de Ctrl+C : au deuxième, Claude Code quitte.
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
  // 1. Échap, puis un second si l'agent travaille encore (Claude Code et Codex
  //    interrompent au premier ou au second selon l'état). Pas de second Échap
  //    sur un agent déjà arrêté : sur un champ vide, il ouvrirait le retour en arrière.
  for (let i = 0; i < 2; i++) {
    await key('esc')
    res.esc++
    if (await settle(d, p.id, 2500)) break
    // Seul un sous-agent de fond tient l'agent au travail : Échap n'y peut rien.
    if (p.agent === 'claude' && (await screen(d, p.id).catch(() => null))?.agents) break
  }
  // 2. Claude : arrêter shells et sous-agents de fond depuis leur panneau.
  if (p.agent === 'claude') {
    let opened = 0
    for (let step = 0; step < 16; step++) {
      const s = await screen(d, p.id).catch(() => null)
      if (!s) break
      const k = nextBackgroundKey(s, opened)
      if (!k) break
      if (k === 'down' && !s.panel) {
        // Un sous-agent déjà arrêté reste listé sous le pied : on n'ouvre la liste
        // que pour des shells, ou si l'agent travaille encore.
        if (!s.shells && (await status(d, p.id).catch(() => 'working')) !== 'working') break
        opened++
        await key('down')
        await d.sleep(700)
        // Shells : ↓ sélectionne le pied (« 2 shells »), Entrée ouvre la liste.
        const after = await screen(d, p.id).catch(() => null)
        if (after && !after.panel) { await key('enter'); await d.sleep(700) }
        continue
      }
      await key(k)
      if (k === 'x') res.background++
      // « x » enchaîné trop vite est ignoré par Claude Code.
      await d.sleep(k === 'x' ? 1200 : 500)
      if (k === 'esc') break
    }
  }
  res.stopped = await settle(d, p.id, res.background ? 4000 : 1500)
  return res
}
