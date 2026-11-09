// Claude Code's input field read from its ANSI screen, and the keys that empty it
// (core drafts, coreDraft.ts; prompt taken back after a Stop, interruptRestore.ts).
import { isUploadLine } from '../../shared/queuedMatch'

// Message text without photo paths (which became images in Claude).
export const msgText = (t: string) => String(t || '').split('\n').filter(l => !isUploadLine(l)).join('\n').trim()

// Content of Claude Code's input field, read from the ANSI screen: the
// "❯" line followed by a non-breaking space (queued messages have a normal
// space), then its continuation lines up to the rule. The grayed-out help text
// ("Press up to edit queued messages") does not count. null: field not found.
// A "!" typed first switches Claude to bash mode (Claude Code 2.1.288): the
// "!" leaves the field and becomes its prompt ("!" + non-breaking space, pink
// rules, "! for shell mode" below). The field then reads as the message that
// was typed, "!" first: "! cmd" typed shows "!\u00a0 cmd" and reads "! cmd";
// bash mode left empty reads "!".
// Grayed-out text never counts: Claude Code's placeholder ('Try "fix
// typecheck errors"' in a fresh session), its next-message suggestion and
// completions are drawn in SGR 2 (dim), cleared by SGR 0 or 22, possibly
// inside a combined sequence ("\x1b[2;37m").
// Without colors (NO_COLOR, TERM=dumb), Claude draws its placeholders as
// plain text: a field holding one of them alone, on a screen with no SGR at
// all, reads empty. A next-message suggestion cannot be told from a draft
// there and still reads as text.
const ESC = String.fromCharCode(27)
const SGR = new RegExp(`${ESC}\\[[0-9;]*[A-Za-z]`, 'g')
const COLOR_SGR = new RegExp(`${ESC}\\[[0-9;:]*m`)
const RULE = /^\s*─{3,}/
const PLACEHOLDER_HINT = /^(?:Try ".*"|Press up to edit queued messages)$/

// The line without its dim characters nor escape sequences.
function undimmed(line: string): string {
  let out = ''
  let dim = false
  let last = 0
  for (const m of line.matchAll(SGR)) {
    if (!dim) out += line.slice(last, m.index)
    last = m.index! + m[0].length
    if (!m[0].endsWith('m')) continue
    const codes = m[0].slice(2, -1).split(';')
    for (let i = 0; i < codes.length; i++) {
      const c = Number(codes[i] || 0)
      if (c === 0 || c === 22) dim = false
      else if (c === 2) dim = true
      else if (c === 38 || c === 48 || c === 58) i += codes[i + 1] === '5' ? 2 : codes[i + 1] === '2' ? 4 : 0
    }
  }
  if (!dim) out += line.slice(last)
  return out
}

export function inputBox(ansi: string): string | null {
  const lines = String(ansi || '').split('\n').map(l => l.replace(/\r$/, ''))
  let at = -1
  let bash = false
  for (let i = lines.length - 1; i >= 0; i--) {
    const plain = lines[i]!.replace(SGR, '')
    if (plain.startsWith('❯\u00a0')) { at = i; break }
    if (plain.startsWith('!\u00a0') && RULE.test((lines[i - 1] || '').replace(SGR, ''))) { at = i; bash = true; break }
  }
  if (at < 0) return null
  const out: string[] = []
  for (let i = at; i < lines.length; i++) {
    const plain = undimmed(lines[i]!)
    if (i > at && RULE.test(plain)) break
    out.push((i === at ? plain.slice(2) : plain.replace(/^ {1,2}/, '')).replace(/\u00a0/g, ' ').trimEnd())
  }
  let box = out.join('\n').trim()
  if (!bash && PLACEHOLDER_HINT.test(box) && !COLOR_SGR.test(ansi)) box = ''
  return bash ? `!${box && ' '}${box}` : box
}

// Keys that empty a field of `lines` lines.
export function clearKeys(lines: number): string[] {
  const keys: string[] = []
  for (let i = 0; i < Math.min(Math.max(lines, 1) + 2, 200); i++) keys.push('ctrl+u', 'backspace')
  return keys
}
