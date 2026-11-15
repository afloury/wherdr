// The first message typed in the "New agent" sheet, kept per pane until the agent's
// conversation exists: the chat shows it at once (optimistic bubble) instead of
// "No conversation for this agent yet" while the transcript is being found.
import { ref } from 'vue'

const prompts = ref<Record<string, string>>({})

export function rememberFirstPrompt(paneId: string, text: string) {
  const t = text.trim()
  if (paneId && t) prompts.value = { ...prompts.value, [paneId]: t }
}

export function firstPromptOf(paneId: string): string {
  return prompts.value[paneId] || ''
}

export function forgetFirstPrompt(paneId: string) {
  if (!(paneId in prompts.value)) return
  const { [paneId]: _gone, ...rest } = prompts.value
  prompts.value = rest
}
