// How a message reaches an agent (app/composables/useActions.ts sendMessage).
import type { Pane } from './types'

// true: /api/prompt — sent as a message, or held by the server until the
// agent's input field is back. false: /api/input — typed as is, followed by
// Enter, as the answer to the question on screen.
// Blocked on a question: the text is its typed answer. Blocked on a menu or a
// screen with no question (/mcp…): typed now it would be lost in it; held.
// omp: only its free-answer field takes typed text; its select dialog (tool
// approval) or "Ask" list would lose it, and Enter would answer them in the
// user's place.
export function viaPrompt(p: Pick<Pane, 'agent' | 'status' | 'prompt'> | undefined): boolean {
  if (!p || !p.agent) return false
  if (p.status !== 'blocked') return true
  if (p.agent === 'omp') return !p.prompt?.typing
  return !p.prompt && (p.agent === 'claude' || p.agent === 'codex')
}
