// Commands shown as code (an agent's replies, TASKS.md tasks) can be copied,
// and run in the agent's own terminal, in its shell mode ("! cmd": Claude
// Code's bash mode, Codex and omp likewise; utils/shellCommand.ts). Shared by
// the conversation (ChatView.vue) and the task text of the Project panel and
// the Board (TaskText.vue), so both run a command the same way.
import type { Pane, QueuedMessage } from '#shared/types'

// The pane takes commands now: online, not stale, an agent with a shell mode.
export const canRunIn = (pane: Pane | null | undefined): pane is Pane =>
  Boolean(pane) && eventsOpen.value && !offlineView.value && !paneStale(pane) && canRunCommands(pane!.agent)

// What the user confirms a command for: the same agent, session, folder and
// machine. Any change while the confirmation is open sends nothing.
export const sameTarget = (a: Pane, b: Pane | null | undefined) => Boolean(b)
  && a.id === b!.id && (a.machine || '') === (b!.machine || '') && a.agent === b!.agent
  && a.agentSession === b!.agentSession && a.cwd === b!.cwd

const livePane = (id: string) => herdrState.value.panes.find(p => p.id === id)

// Why the pane cannot take the command now, or null.
function refusal(pane: Pane | undefined): string | null {
  if (!canRunIn(pane)) return tl('The agent can no longer run commands (offline, or no agent in the pane): nothing was sent.', 'L’agent ne peut plus lancer de commande (hors ligne, ou plus d’agent dans le pane) : rien n’a été envoyé.')
  // A question on screen would take the command as its typed answer.
  if (pane.status === 'blocked' && pane.prompt) return tl('The agent is waiting for your answer: answer it first.', 'L’agent attend ta réponse : réponds-lui d’abord.')
  return null
}

// The confirmation names where the command goes: agent, pane, machine, folder.
export function runQuestion(pane: Pane): string {
  const name = kindLabel(pane.agent)
  // The space ("acme"), then the pane's own title when it says more.
  const space = workspaceLabel(herdrState.value, pane)
  const own = paneTitle(pane)
  const title = [space, own].filter((x, i, all) => x && x.toLowerCase() !== name.toLowerCase() && all.indexOf(x) === i).join(' › ') || own
  const machine = pane.machine ? machineName(pane.machine) : ''
  const folder = pane.cwd ? shortPath(pane.cwd) : ''
  return tl(
    `Run this command in ${name} “${title}”${machine ? ` on ${machine}` : ''}? It runs in its shell mode (!), in ${folder || 'its own folder'}, and shows the output in the conversation.`,
    `Lancer cette commande dans ${name} « ${title} »${machine ? ` sur ${machine}` : ''} ? Elle s’exécute dans son mode shell (!), dans ${folder || 'son propre dossier'}, et la sortie s’affiche dans la conversation.`,
  )
}

// Runs `cmd` in the agent of pane `paneId`, only after the user has seen it in
// full, with its target, and confirmed. Never on its own. The pane is read
// again once confirmed: if it changed (another agent or session, another
// folder, offline, a question on screen), nothing is sent. null or a queued
// message: sent. false: not sent (the user has been told when it matters).
export async function runInAgent(paneId: string, cmd: string): Promise<QueuedMessage | null | false> {
  const pane = livePane(paneId)
  const before = refusal(pane)
  if (before || !pane) {
    if (before) toast(before, true)
    return false
  }
  const text = runMessage(pane.agent, cmd)
  if (!text) return false
  haptic()
  const ok = await askConfirm(runQuestion(pane), tl('Run', 'Lancer'), 'primary', cmd)
  if (!ok) return false
  const now = livePane(paneId)
  if (!sameTarget(pane, now)) {
    toast(tl('The agent changed while you were confirming: nothing was sent. Check it and run the command again.', 'L’agent a changé pendant la confirmation : rien n’a été envoyé. Vérifie-le et relance la commande.'), true)
    return false
  }
  const after = refusal(now)
  if (after) {
    toast(after, true)
    return false
  }
  try {
    const queued = await sendMessage(now, now!.id, text)
    haptic()
    return queued
  } catch (err) {
    toast((err as Error).message, true)
    return false
  }
}

export async function copyCode(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast(t('Copied'))
  } catch { toast(t('Copy failed'), true) }
}
