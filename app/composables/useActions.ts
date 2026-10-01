// Actions sur les agents partagées entre la liste et la vue agent.
import type { Pane, QueuedMessage, WaitAction } from '#shared/types'
import { type RestartPreview, RESTARTABLE, restartNotice } from '#shared/restart'

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

// Appuyer sur une touche de la légende d'un écran d'attente (le serveur revérifie l'écran).
export async function pressScreenKey(paneId: string, a: WaitAction): Promise<boolean> {
  haptic()
  try {
    await api('/api/screen-key', { pane_id: paneId, key: a.key, label: a.label })
    toast(`✓ ${screenActionLabel(a)}`)
    return true
  } catch (err) {
    toast((err as Error).message, true)
    return false
  }
}

// Menu interactif de Claude Code (/resume…) : choisir une entrée, appuyer sur
// une touche de sa légende, remplacer le texte de sa recherche. Le serveur
// relit l'écran avant chaque touche.
export async function menuAction(paneId: string, body: { op: 'select', index: number, label: string } | { op: 'key', key: string, label: string } | { op: 'search', text: string }): Promise<boolean> {
  haptic()
  try {
    await api('/api/menu', { pane_id: paneId, ...body })
    if (body.op === 'select') toast(`✓ ${body.label}`)
    return true
  } catch (err) {
    toast((err as Error).message, true)
    return false
  }
}

// Clavier de l'ordinateur sur une carte « À toi » : une vraie touche au
// terminal (le serveur vérifie qu'un menu ou une invite est encore affiché).
// Touches envoyées l'une après l'autre, dans l'ordre de frappe.
let navChain: Promise<unknown> = Promise.resolve()
export function navKey(paneId: string, key: 'up' | 'down' | 'enter' | 'esc'): Promise<boolean> {
  const run = navChain.then(async () => {
    try {
      await api('/api/nav', { pane_id: paneId, key })
      return true
    } catch (err) {
      toast((err as Error).message, true)
      return false
    }
  })
  navChain = run
  return run
}

// Envoyer un message à un agent (champ de saisie, panneau Projet). Agent bloqué :
// l'invite attend une saisie libre (« Type something… »), agent.prompt la
// refuserait : on tape le texte tel quel. Agent au travail : le serveur met le
// message en file (renvoyé dans `queued`).
export async function sendMessage(p: Pane | undefined, paneId: string, text: string): Promise<QueuedMessage | null> {
  // Blocked on a question: the text is its typed answer. Blocked on a menu or
  // a screen with no question (/mcp…): typed now it would be lost in it; the
  // server holds it until the input field is back.
  const r = p && p.agent && (p.status !== 'blocked' || (!p.prompt && ['claude', 'codex'].includes(p.agent)))
    ? await api<{ queued?: QueuedMessage }>('/api/prompt', { pane_id: paneId, text })
    : await api<{ queued?: QueuedMessage }>('/api/input', { pane_id: paneId, text, keys: ['enter'] })
  return r.queued || null
}

export const STATUS: Record<string, { label: string, order: number }> = {
  blocked: { label: 'Your turn', order: 0 },
  done: { label: 'Done', order: 1 },
  working: { label: 'Working', order: 2 },
  idle: { label: 'Ready', order: 3 },
  unknown: { label: 'Unknown', order: 4 },
}

export function statusKey(p: Pane) {
  return p.agent ? p.status || 'unknown' : 'shell'
}
export function statusLabel(p: Pane) {
  const s = statusKey(p)
  if (!p.agent) return 'Shell'
  if (p.restart && p.restart.phase !== 'failed') return t('Restarting')
  if (s === 'unknown' && p.pendingPrompt) return t('Starting')
  return t((STATUS[s] || STATUS.unknown!).label)
}

// Redémarrer l'agent dans son pane (mise à jour installée…) en reprenant sa
// conversation. Confirmation seulement s'il y a quelque chose à dire : agent
// au travail ou en attente, options de lancement non retrouvées, conversation
// vide. Le suivi s'affiche ensuite au-dessus du champ (pane.restart).
export async function restartAgent(p: Pane) {
  if (!p.agent || !canRestart(p)) return
  const who = kindLabel(p.agent)
  let pv: RestartPreview
  try {
    pv = await api<RestartPreview>(`/api/restart?pane=${encodeURIComponent(p.id)}`)
  } catch (err) { return toast((err as Error).message, true) }
  const n = restartNotice(p.status, pv)
  if (n.confirm) {
    const lines: string[] = []
    if (n.busy) lines.push(tl(`${who} is working: restarting it will interrupt what it is doing.`, `${who} est en train de travailler : le redémarrer interrompra son travail en cours.`))
    else lines.push(tl(`Restart ${who}? It will resume the same conversation.`, `Redémarrer ${who} ? Il reprendra la même conversation.`))
    if (n.fresh) lines.push(tl('This conversation is still empty: the agent will start a new one.', 'Cette conversation est encore vide : l’agent repartira sur une conversation neuve.'))
    if (n.defaults) lines.push(tl('Launch options not found: the agent will restart with your default settings (model, effort, permissions).', 'Options de lancement introuvables : l’agent repartira avec tes réglages par défaut (modèle, effort, permissions).'))
    else if (n.dropped.length) lines.push(tl(`Options not kept, the agent will use your defaults for: ${n.dropped.join(' ')}`, `Options non reprises, l’agent repartira avec tes réglages par défaut pour : ${n.dropped.join(' ')}`))
    const ok = await askConfirm(lines.join('\n\n'), n.busy ? t('Restart anyway') : t('Restart'), n.busy ? 'error' : 'primary')
    if (!ok) return
  }
  haptic()
  try {
    await api('/api/restart', { pane_id: p.id })
  } catch (err) { toast((err as Error).message, true) }
}
export const canRestart = (p: Pane) => Boolean(p.agent && RESTARTABLE.has(p.agent))
export async function dismissRestart(paneId: string) {
  try { await api('/api/restart', { pane_id: paneId, dismiss: true }) }
  catch (err) { toast((err as Error).message, true) }
}

export async function closePane(p: Pane) {
  const workspace = herdrState.value.workspaces.find(w => w.id === p.workspace)
  const what = p.agent
    ? tl(`${kindLabel(p.agent)} “${paneTitle(p)}”`, `${kindLabel(p.agent)} « ${paneTitle(p)} »`)
    : tl(`the terminal in space “${workspace?.label || paneTitle(p)}”`, `le terminal de l’espace « ${workspace?.label || paneTitle(p)} »`)
  const plan = await confirmClose('pane', p.id,
    tl(`Close ${what}? The process will be stopped.`, `Fermer ${what} ? Le processus sera arrêté.`),
    t('Close pane'),
  )
  if (!plan) return
  // Fermé depuis sa vue : son onglet s'il y reste des panes, sinon l'onglet
  // voisin, sinon la liste. Fermé depuis le plan : on y reste.
  const done = prepareClose(plan.group ? { workspace: p.workspace } : { pane: p.id }, plan.group ? plan.workspaces.map(w => w.id) : [])
  try {
    await api('/api/close', { pane_id: p.id, close_group: plan.group })
    toast(plan.group ? tl('Group closed', 'Groupe fermé') : t('Pane closed'))
    done(true)
  } catch (err) {
    done(false)
    toast((err as Error).message, true)
  }
}
