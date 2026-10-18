// Commands shown as code (an agent's replies, TASKS.md tasks) can be copied,
// and run in the agent's own terminal, in its shell mode ("! cmd": Claude
// Code's bash mode, Codex and omp likewise; utils/shellCommand.ts). Shared by
// the conversation (ChatView.vue) and the task text of the Project panel and
// the Board (TaskText.vue), so both run a command the same way.
import type { Pane, QueuedMessage } from '#shared/types'

// The pane takes commands now: online, not stale, an agent with a shell mode.
export const canRunIn = (pane: Pane | null | undefined): pane is Pane =>
  Boolean(pane) && eventsOpen.value && !offlineView.value && !paneStale(pane) && canRunCommands(pane!.agent)

// Runs `cmd` in the pane's agent, only after the user has seen it in full and
// confirmed. Never on its own. null or a queued message: sent. false: not
// sent (cancelled, refused or failed; the user has been told).
export async function runInAgent(pane: Pane, cmd: string): Promise<QueuedMessage | null | false> {
  const text = runMessage(pane.agent, cmd)
  if (!text || !canRunIn(pane)) return false
  // A question on screen would take the command as its typed answer.
  if (pane.status === 'blocked' && pane.prompt) {
    toast(tl('The agent is waiting for your answer: answer it first.', 'L’agent attend ta réponse : réponds-lui d’abord.'), true)
    return false
  }
  haptic()
  const name = kindLabel(pane.agent)
  const ok = await askConfirm(
    tl(`Run this command? ${name} runs it in its shell mode (!), in its own folder, and shows the output in the conversation.`,
      `Lancer cette commande ? ${name} l’exécute dans son mode shell (!), dans son propre dossier, et affiche la sortie dans la conversation.`),
    tl('Run', 'Lancer'), 'primary', cmd,
  )
  if (!ok) return false
  try {
    const queued = await sendMessage(pane, pane.id, text)
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
