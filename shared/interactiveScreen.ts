// Existing native recognizers own presentation. This policy only supplies the
// live-terminal fallback; it never reinterprets their choices, menus or details.
import type { Choices } from './types'
import { hasTranscript } from './agentKind'

export type ScreenInteraction = 'input' | 'native' | 'terminal' | 'working' | 'unknown' | 'managed'

// Deliberately short exception list: these screens are either unrecognized or
// misread as choices by the existing recognizers. Do not generalize this into
// stricter rules for native questions (descriptions, tabs and checkboxes work).
export function terminalException(text: string): boolean {
  return /^\s*Agent Command Center\s*$/im.test(text)
    || (/^\s*Usage\s*$/im.test(text)
      && /View analytics {2,}Usage history/.test(text)
      && /Redeem reset {2,}Check availability/.test(text))
}

// Search the full field, including long drafts and wrapped status bars. Native
// recognition runs first, so a recognized menu cursor never becomes a field.
export function confirmedInput(text: string): boolean {
  const lines = text.trimEnd().split('\n')
  const at = lines.findLastIndex(l => /^\s*[❯›](?:\s|$)/.test(l) || /^!(?:\s|$)/.test(l) || /^╰─(?:\s|$)/.test(l))
  if (at < 0) return false
  const line = lines[at]!
  const below = lines.slice(at + 1).join('\n')
  if (/\b(?:enter|esc|escape)\s+(?:to\s+)?(?:select|open|back|cancel|confirm|close)\b/i.test(below)) return false
  if (/^\s*[❯›]\s+\d{1,2}\.\s/.test(line)) return false
  if (/^╰─(?:\s|$)/.test(line)) return true
  if (/^\s*›(?:\s|$)/.test(line)) return /for shortcuts|context left|\b(?:gpt-[\w.-]+|o[1-9](?:-[\w.-]+)?)\b.*·/i.test(below)
  return /^\s*─{3,}/.test(lines[at - 1] || '')
}

export function classifyScreen(o: {
  text: string, agent?: string | null, choices?: Choices | null,
  menu?: unknown, screen?: unknown, settings?: boolean, status?: string | null,
}): ScreenInteraction {
  if (o.status === 'working') return 'working'
  // Only the two active Codex menus override a mistaken list recognition.
  // A completed/closed agent may retain its kind while showing a shell.
  if (o.status !== 'unknown' && o.agent === 'codex' && terminalException(o.text)) return 'terminal'
  if (o.choices || o.menu || o.screen || o.settings) return 'native'
  // Unsupported agents already have their permanent Terminal view. An absent
  // transcript/input recognizer is not evidence of an interactive screen.
  if (o.status === 'unknown' || !hasTranscript(o.agent) || !o.text.trim()) return 'unknown'
  if (confirmedInput(o.text)) return 'input'
  return 'terminal'
}
