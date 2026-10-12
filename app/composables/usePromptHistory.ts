import { addPromptHistory, PROMPT_HISTORY_MAX } from '../utils/promptHistory'

// Per-device, per-pane history survives reloads. No transcript reads: commands
// absent from a conversation are remembered alongside ordinary messages.
const histories = new Map<string, string[]>()
const key = (paneId: string) => `prompt-history:${paneId}`
export function promptHistoryFor(paneId: string): string[] {
  let entries = histories.get(paneId)
  if (!entries) {
    entries = []
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(key(paneId)) || '[]')
      if (Array.isArray(stored)) entries = stored.filter((s): s is string => typeof s === 'string' && Boolean(s.trim())).slice(-PROMPT_HISTORY_MAX)
    } catch { /* Storage unavailable or invalid: keep an in-memory history. */ }
    histories.set(paneId, entries)
  }
  return entries
}
export function rememberPrompt(paneId: string, text: string) {
  const entries = addPromptHistory(promptHistoryFor(paneId), text)
  histories.set(paneId, entries)
  try { localStorage.setItem(key(paneId), JSON.stringify(entries)) } catch { /* Storage unavailable or full. */ }
}
