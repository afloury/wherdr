// Presentation policy, independent of agent commands. Parsers may extract more
// than we can safely offer as native buttons; ambiguity always keeps the TUI.
import type { Choices } from './types'

export type ScreenInteraction = 'input' | 'native' | 'terminal' | 'working' | 'unknown' | 'managed'

const NUMBER = /^\s*(?:[❯›>]\s+)?(\d{1,2})\.\s+(\S.*?)\s*$/
const COLUMN = /\S(?: {2,}|\t|\s*[│|]\s*)\S/
const APPROVAL = /^(?:yes\b|no\b|approve\b|deny\b|allow\b|reject\b)/i

export function nativePrompt(text: string, choices: Choices | null | undefined): boolean {
  if (!choices || choices.multi || choices.tabs?.length) return false
  // An already-open free-answer field has no choice mapping to guess.
  if (choices.typing) return choices.options.length === 1 && choices.options[0]?.free === true
  const options = choices.options
  if (options.length < 2 || options.some(o => COLUMN.test(o.label))) return false
  // Tool approvals have a separately parsed command/diff; keep that context.
  if (choices.detail && options.every(o => APPROVAL.test(o.label))) return true
  if (options.some(o => o.hint || o.checked !== undefined || o.free)) return false
  if (options.some((o, i) => o.n !== i + 1)) return false
  const lines = text.trimEnd().split('\n')
  const cursor = lines.findLastIndex(l => /^\s*[❯›>]\s+\d{1,2}\.\s/.test(l))
  if (cursor < 0) return false
  // Only this contiguous list: no descriptions, separate columns or partial
  // windows. Do not collect numbered prose from earlier conversation history.
  let first = cursor
  let last = cursor
  while (first > 0 && NUMBER.test(lines[first - 1]!)) first--
  while (last + 1 < lines.length && NUMBER.test(lines[last + 1]!)) last++
  const block = lines.slice(first, last + 1)
  if (block.length !== options.length || block.filter(l => /^\s*[❯›>]/.test(l)).length !== 1) return false
  if (block.some((l, i) => {
    const m = NUMBER.exec(l)!
    return Number(m[1]) !== i + 1 || m[2] !== options[i]!.label || COLUMN.test(m[2]!)
  })) return false
  // Any indented text immediately after the last option is a description,
  // unless it is a separate, explicit keyboard legend.
  const after = lines[last + 1]?.trim()
  return !after || /\b(?:enter|esc|escape)\b/i.test(after)
}

// A menu cursor is not a message field. In particular, Codex uses the same
// glyph for both; keyboard legends and numbered options disambiguate it.
export function confirmedInput(text: string): boolean {
  const lines = text.trimEnd().split('\n').slice(-12)
  const at = lines.findLastIndex(l => /^\s*[❯›](?:\s|$)/.test(l) || /^!(?:\s|$)/.test(l) || /^╰─(?:\s|$)/.test(l))
  if (at < 0) return false
  const line = lines[at]!
  const below = lines.slice(at + 1).join('\n')
  if (/\b(?:enter|esc|escape)\s+(?:to\s+)?(?:select|open|back|cancel|confirm|close)\b/i.test(below)) return false
  if (/^\s*[❯›]\s+\d{1,2}\.\s/.test(line)) return false
  if (/^╰─(?:\s|$)/.test(line)) return true
  if (/^\s*›(?:\s|$)/.test(line)) return lines.slice(at + 1).filter(l => l.trim()).length <= 2
    && /for shortcuts|context left|\b(?:gpt-[\w.-]+|o[1-9](?:-[\w.-]+)?)\b.*·/i.test(below)
  return /^\s*─{3,}/.test(lines[at - 1] || '')
}

export function classifyScreen(o: { text: string, choices?: Choices | null, waiting?: boolean, status?: string | null }): ScreenInteraction {
  if (!o.text.trim()) return 'unknown'
  if (o.status === 'working') return confirmedInput(o.text) ? 'input' : 'working'
  if (o.choices && nativePrompt(o.text, o.choices)) return 'native'
  if (o.choices || o.waiting) return 'terminal'
  if (confirmedInput(o.text)) return 'input'
  // A nonempty screen without a confirmed field is not safe to reconstruct.
  return 'terminal'
}
