// Agent actions shared between the list and the agent view.
import type { Pane, QueuedMessage, WaitAction } from '#shared/types'
import { type RestartPreview, RESTARTABLE, restartNotice } from '#shared/restart'

// Choose an option of a blocking prompt (the server re-checks the screen).
// Free-answer option (`free`): with its text, typed by the server, and the
// question shown ("Other" has the same label for every question).
export async function choose(paneId: string, index: number, label: string, free?: { text: string, question: string | null }): Promise<boolean> {
  haptic()
  try {
    await api('/api/choose', { pane_id: paneId, index, label, ...free })
    const said = free && free.text.replace(/\s+/g, ' ').slice(0, 60)
    toast(`✓ ${said ? tl(`“${said}”`, `« ${said} »`) : label}`)
    return true
  } catch (err) {
    toast((err as Error).message, true)
    return false
  }
}

// omp "Ask" box with tabs: show question `index` (or Submit).
export async function askTab(paneId: string, index: number, label: string): Promise<boolean> {
  haptic()
  try {
    await api('/api/ask-tab', { pane_id: paneId, index, label })
    return true
  } catch (err) {
    toast((err as Error).message, true)
    return false
  }
}

// Press a key from the legend of a waiting screen (the server re-checks the screen).
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

// Claude Code interactive menu (/resume…): choose an entry, press
// a key from its legend, replace the text of its search. The server
// re-reads the screen before each key.
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

// Computer keyboard on a "Your turn" card: a real key to the
// terminal (the server checks that a menu or prompt is still shown; ← → only
// on omp's "Ask" box with tabs).
// Keys sent one after the other, in typing order.
let navChain: Promise<unknown> = Promise.resolve()
export function navKey(paneId: string, key: 'up' | 'down' | 'enter' | 'esc' | 'left' | 'right'): Promise<boolean> {
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

// Send a message to an agent (input field, Project panel). Blocked agent:
// the prompt is waiting for free input ("Type something…"), agent.prompt
// would refuse it: we type the text as is. Working agent: the server
// queues the message (returned in `queued`).
// `clientId`: id of the bubble already shown for it (see utils/outbox.ts); the
// server keeps it for its record, so the bubble never changes identity.
export async function sendMessage(p: Pane | undefined, paneId: string, text: string, clientId?: string): Promise<QueuedMessage | null> {
  const r = viaPrompt(p)
    ? await api<{ queued?: QueuedMessage }>('/api/prompt', { pane_id: paneId, text, ...(clientId ? { client_id: clientId } : {}) })
    : await api<{ queued?: QueuedMessage }>('/api/input', { pane_id: paneId, text, keys: ['enter'] })
  return r.queued || null
}
// Blocked on a question: the text is its typed answer (/api/input). Blocked on a menu or
// a screen with no question (/mcp…): typed now it would be lost in it; the
// server holds it until the input field is back (/api/prompt).
export const viaPrompt = (p: Pane | undefined) => Boolean(p && p.agent && (p.status !== 'blocked' || (!p.prompt && ['claude', 'codex'].includes(p.agent))))

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

// Restart the agent in its pane (update installed…) while resuming its
// conversation. Confirmation only if there is something to say: agent
// working or waiting, launch options not found, empty
// conversation. The progress then shows above the field (pane.restart).
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
  // Closed from its view: its tab if panes remain there, otherwise the neighbouring
  // tab, otherwise the list. Closed from the plan: we stay there.
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
