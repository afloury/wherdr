// Actions sur les agents partagées entre la liste et la vue agent.
import type { Pane, QueuedMessage } from '#shared/types'

// Choisir une option d'une invite bloquante (le serveur revérifie l'écran).
export async function choose(paneId: string, index: number, label: string): Promise<boolean> {
  haptic()
  try {
    await api('/api/choose', { pane_id: paneId, index, label })
    toast(`✓ ${label}`)
    return true
  } catch (err) {
    toast((err as Error).message, true)
    return false
  }
}

// Envoyer un message à un agent (champ de saisie, panneau Projet). Agent bloqué :
// l'invite attend une saisie libre (« Type something… »), agent.prompt la
// refuserait : on tape le texte tel quel. Agent au travail : le serveur met le
// message en file (renvoyé dans `queued`).
export async function sendMessage(p: Pane | undefined, paneId: string, text: string): Promise<QueuedMessage | null> {
  const r = p && p.agent && p.status !== 'blocked'
    ? await api<{ queued?: QueuedMessage }>('/api/prompt', { pane_id: paneId, text })
    : await api<{ queued?: QueuedMessage }>('/api/input', { pane_id: paneId, text, keys: ['enter'] })
  return r.queued || null
}

export const STATUS: Record<string, { label: string, order: number }> = {
  blocked: { label: 'À toi', order: 0 },
  done: { label: 'Terminé', order: 1 },
  working: { label: 'Au travail', order: 2 },
  idle: { label: 'Prêt', order: 3 },
  unknown: { label: 'Inconnu', order: 4 },
}

export function statusKey(p: Pane) {
  return p.agent ? p.status || 'unknown' : 'shell'
}
export function statusLabel(p: Pane) {
  const s = statusKey(p)
  if (!p.agent) return 'Shell'
  if (s === 'unknown' && p.pendingPrompt) return t('Démarrage')
  return t((STATUS[s] || STATUS.unknown!).label)
}

export async function closePane(p: Pane) {
  const workspace = herdrState.value.workspaces.find(w => w.id === p.workspace)
  const what = p.agent
    ? tl(`${kindLabel(p.agent)} « ${paneTitle(p)} »`, `${kindLabel(p.agent)} “${paneTitle(p)}”`)
    : tl(`le terminal de l’espace « ${workspace?.label || paneTitle(p)} »`, `the terminal in space “${workspace?.label || paneTitle(p)}”`)
  const plan = await confirmClose('pane', p.id,
    tl(`Fermer ${what} ? Le processus sera arrêté.`, `Close ${what}? The process will be stopped.`),
    t('Fermer le pane'),
  )
  if (!plan) return
  // Fermé depuis sa vue : son onglet s'il y reste des panes, sinon l'onglet
  // voisin, sinon la liste. Fermé depuis le plan : on y reste.
  const done = prepareClose(plan.group ? { workspace: p.workspace } : { pane: p.id }, plan.group ? plan.workspaces.map(w => w.id) : [])
  try {
    await api('/api/close', { pane_id: p.id, close_group: plan.group })
    toast(plan.group ? tl('Groupe fermé', 'Group closed') : t('Pane fermé'))
    done(true)
  } catch (err) {
    done(false)
    toast((err as Error).message, true)
  }
}
