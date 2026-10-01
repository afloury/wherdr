// Reading agents' blocking prompts (tool approval, AskUserQuestion,
// folder trust…) from Herdr's "detection" text, to offer them
// as buttons on the phone.
//
// Two forms seen in Claude Code:
//
//   Quelle est ta couleur préférée ?          Security guide
//
//   ❯ 1. Rouge                                ❯ No, exit
//        La couleur rouge                       Yes, I trust this folder
//     2. Vert
//        La couleur verte                     Enter to confirm · Esc to cancel
//
// The ❯ cursor marks the selected option. We answer by moving the
// cursor (↑/↓) then Enter, which works for both forms.
import type { ChoiceOption, Choices } from '../../shared/types'
import { isPermissionQuestion, screenDetail } from './promptDetail'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

// ❯ in Claude Code, › in Codex; > on Codex's login screen, only taken
// before a numbered option (otherwise a "> …" quote would count).
const CURSOR = /^(\s*)(?:[❯›]|>(?=\s+\d{1,2}\.\s))\s+(\S.*?)\s*$/
const NUMBERED = /^(\s*)(?:[❯›>]\s+)?(\d{1,2})\.\s+(\S.*?)\s*$/
const RULE = /^[\s─━═—-]+$/
// Start of a neighbouring column: at least 3 spaces or a vertical bar │.
const GAP = /\S(?: {3,}| *│ *)(?=\S)/g

// Columns where text resumes after a gap, on a line.
function gapColumns(line: string): number[] {
  const cols: number[] = []
  for (const m of line.matchAll(GAP)) {
    const bar = m[0].indexOf('│')
    cols.push(m.index! + (bar >= 0 ? bar : m[0].length))
  }
  return cols
}

// Claude Code may show a panel to the right of the dialog box (diff
// view "N files changed"): each screen line then carries both
// columns. The neighbouring column is recognized by a gap on a text line
// outside the options (the question), at the same position as a blank followed by text
// on the cursor line; the aligned descriptions of a list (/model)
// only appear on option lines. We then cut the screen at that
// column.
function dropSidePanel(lines: string[], c: number): string[] {
  const cursor = lines[c]!
  const splitsCursor = (x: number) => x < cursor.length && /[\s│]/.test(cursor[x - 1]!) && /\S/.test(cursor[x]!)
  // Only the two text lines just above the options count:
  // further up, a boxed header (Codex) may line up by chance.
  let split = -1
  let seen = 0
  for (let i = c - 1; i >= Math.max(0, c - 40) && split < 0 && seen < 2; i--) {
    const line = lines[i]!
    if (!line.trim() || NUMBERED.test(line) || CURSOR.test(line)) continue
    seen++
    split = gapColumns(line).find(splitsCursor) ?? -1
  }
  if (split < 0) return lines
  return lines.map((line) => {
    if (line.length <= split || !/[\s│]/.test(line[split - 1]!)) return line
    return line.slice(0, split).replace(/[\s│]+$/, '')
  })
}

// Column (in characters) where the text of an option line starts.
function textColumn(line: string): number {
  const m = line.match(/^(\s*)(?:(?:[❯›]|>(?=\s+\d))\s+)?/)
  return m ? m[0].length : 0
}

interface RawOption { n: number | null, label: string, hint: string | null, line: number }

// `strict`: only accept numbered lists. Used when Herdr does not see
// the agent as blocked (Codex's trust screen passes for "idle"):
// an unnumbered list could then just be the input field
// ("› Ask Codex…" followed by the model line, aligned the same way).
export function parseChoices(text: string | null | undefined, { strict = false }: { strict?: boolean } = {}): Choices | null {
  if (!text) return null
  let lines = text.replace(/\s+$/, '').split('\n').slice(-60)

  // The last ❯ on screen: the previous ones are history (prompts
  // sent), the active prompt is always at the bottom.
  let c = -1
  for (let i = lines.length - 1; i >= 0; i--) if (CURSOR.test(lines[i]!)) { c = i; break }
  if (c < 0) return null
  lines = dropSidePanel(lines, c)

  const cursorLine = lines[c]!
  const col = textColumn(cursorLine)
  const cursorText = cursorLine.match(CURSOR)![2]!
  const options: RawOption[] = []

  if (/^\d{1,2}\.\s/.test(cursorText)) {
    // Numbered options: we take all those aligned on the same column,
    // on both sides of the cursor (a ─── separator may cut them).
    let first = c
    for (let i = c - 1; i >= Math.max(0, c - 40); i--) {
      const m = lines[i]!.match(NUMBERED)
      if (m && textColumn(lines[i]!) === col) first = i
    }
    for (let i = first; i < lines.length; i++) {
      const line = lines[i]!
      const m = line.match(NUMBERED)
      if (m && textColumn(line) === col) {
        options.push({ n: Number(m[2]), label: m[3]!, hint: null, line: i })
      } else if (options.length && line.trim() && !RULE.test(line) && textColumn(line) > col) {
        // More indented line just below an option: its description.
        const o = options[options.length - 1]!
        if (!o.hint && i === o.line + 1) o.hint = line.trim()
      }
    }
    // Safeguard: a real list is numbered 1, 2, 3… without gaps.
    for (let i = 0; i < options.length; i++) if (options[i]!.n !== i + 1) return null
  } else {
    if (strict) return null
    // Unnumbered options: lines adjacent to the cursor, same text column.
    const sameCol = (l: string) => Boolean(l.trim()) && !RULE.test(l) && !/^\s*[❯›]/.test(l) && textColumn(l) === col
    let first = c
    while (first - 1 >= 0 && sameCol(lines[first - 1]!)) first--
    let last = c
    while (last + 1 < lines.length && sameCol(lines[last + 1]!)) last++
    for (let i = first; i <= last; i++) {
      const label = i === c ? cursorText : lines[i]!.trim()
      options.push({ n: null, label, hint: null, line: i })
    }
  }

  if (options.length < 2 || options.length > 12) return null
  const cursor = options.findIndex(o => o.line === c)
  if (cursor < 0) return null

  // The question: the closest non-empty line above the options,
  // preferably one ending with "?".
  // Failing that, a line containing a "?", then the closest one.
  let question: { t: string, i: number } | null = null
  let asks: { t: string, i: number } | null = null
  let nearest: { t: string, i: number } | null = null
  const top = options[0]!.line
  for (let i = top - 1; i >= Math.max(0, top - 12); i--) {
    const t = lines[i]!.trim()
    if (!t || RULE.test(t)) continue
    if (/\?\s*$/.test(t)) { question = { t, i }; break }
    if (!asks && t.includes('?')) asks = { t, i }
    if (!nearest) nearest = { t, i }
  }
  question = question || asks || nearest

  const out: Choices = {
    question: question ? question.t.replace(/^[☐☒✔●◆▸•\s]+/, '').slice(0, 300) : null,
    cursor,
    options: options.map(o => ({ label: o.label.slice(0, 200), hint: o.hint ? o.hint.slice(0, 200) : null })),
  }
  // Permission request: what is requested (tool, command, file).
  if (question && isPermissionQuestion(out.question)) {
    const detail = screenDetail(lines, question.i, top)
    if (detail) out.detail = detail
  }
  return out
}

// Keys to send to choose option `index` when the cursor is on `cursor`.
// Checkboxes: Space checks or unchecks, without confirming.
export function keysFor(choices: Choices, index: number): string[] {
  const d = index - choices.cursor
  const keys: string[] = []
  for (let i = 0; i < Math.abs(d); i++) keys.push(d > 0 ? 'down' : 'up')
  keys.push(choices.multi ? 'space' : 'enter')
  return keys
}

// omp "Ask" box (ask tool), one question at a time:
//
//   ╭─ Ask ───────────────────────────╮
//   │  color    size    Submit        │   tabs (several questions only)
//   │ Favourite colour?               │
//   ├─────────────────────────────────┤
//   │ ❯ ○ Red                         │   ○ ◉ single choice, ☐ ☑ checkboxes
//   │       warm                      │   description
//   │   ○ Other (type your own)       │   free answer: left to the terminal
//   ├─────────────────────────────────┤
//   │ ⏎ select · ↑/↓ move · ⎋ cancel  │
//   ╰─────────────────────────────────╯
//
// Last step with several questions: "Review answers", the numbered
// answers then "❯ Submit".
// Glyphs of omp's three symbol sets (modes/theme/symbols.ts: unicode,
// nerd font, ascii): cursor, radio buttons, checkboxes, box borders.
const OMP_CURSOR = ['❯', '\uf054', '>']
const OMP_RADIO = ['○', '◉', '\uf10c', '\uf192', '( )', '(o)']
const OMP_CHECK = ['☐', '☑', '\uf096', '\uf14a', '[ ]', '[x]']
const OMP_CHECKED = new Set(['☑', '\uf14a', '[x]'])
const OMP_OPTION = new RegExp(`^(?:(${OMP_CURSOR.join('|').replace(/[>]/g, '\\$&')}) | {2})(${[...OMP_RADIO, ...OMP_CHECK].map(g => g.replace(/[()[\]]/g, '\\$&')).join('|')}) (.+)$`)
const OMP_RULE = /^\s*[├╰+][─-]{3,}/
// Content of a box line, without its borders ("│ text   │").
function ompBoxText(line: string): string | null {
  let s = line.trimStart()
  if (s[0] !== '│' && s[0] !== '|') return null
  s = s.slice(s[1] === ' ' ? 2 : 1).trimEnd()
  if (s.endsWith('│') || s.endsWith('|')) s = s.slice(0, -1).trimEnd()
  return s
}
export function parseOmpAsk(text: string | null | undefined): Choices | null {
  if (!text) return null
  const lines = text.replace(/\s+$/, '').split('\n')
  let top = -1
  for (let i = lines.length - 1; i >= 0 && top < 0; i--) if (/^\s*[╭+][─-]+ Ask\b/.test(lines[i]!)) top = i
  if (top < 0) return null
  // Header, options, legend: separated by rules (the last one closes the box).
  const sections: string[][] = [[]]
  for (const line of lines.slice(top + 1)) {
    if (OMP_RULE.test(line)) { sections.push([]); continue }
    const s = ompBoxText(line)
    if (s === null) break
    sections[sections.length - 1]!.push(s)
  }
  if (sections.length < 3) return null
  const header = sections[0]!.filter(l => l.trim())
  if (header.length && /\S {2,}Submit$/.test(header[0]!.trim())) header.shift()
  const question = header.map(l => l.trim()).join(' ').slice(0, 300) || null
  const list = sections[1]!
  const options: (ChoiceOption & { other?: boolean })[] = []
  let cursor = -1
  let multi = false
  for (const line of list) {
    const m = OMP_OPTION.exec(line)
    if (m) {
      if (m[1]) cursor = options.length
      multi ||= OMP_CHECK.includes(m[2]!)
      options.push({ label: m[3]!.slice(0, 200), hint: null, ...(OMP_CHECKED.has(m[2]!) ? { checked: true } : {}), ...(m[3] === 'Other (type your own)' ? { other: true } : {}) })
    } else if (options.length && line.trim() && !options[options.length - 1]!.hint) {
      options[options.length - 1]!.hint = line.trim().replace(/^↳\s*/, '').slice(0, 200)
    }
  }
  if (!options.length) {
    // "Review answers" step: the answers as Submit's description.
    if (!list.some(l => OMP_CURSOR.some(c => l.trim() === `${c} Submit`))) return null
    const answers = list.map(l => l.trim()).filter(l => /^\d+\.\s/.test(l)).map(l => l.replace(/^\d+\.\s+/, ''))
    return { question, cursor: 0, options: [{ label: 'Submit', hint: answers.join(' · ').slice(0, 200) || null }] }
  }
  if (cursor < 0) return null
  // "Other" opens an omp text field: not a button (always the last
  // option, the others' indexes do not move; `cursor` may point to it).
  const shown = options.filter(o => !o.other).map(({ other: _, ...o }) => (multi ? { ...o, checked: Boolean(o.checked) } : o))
  return { question, cursor, options: shown, ...(multi ? { multi: true } : {}) }
}

// omp's "ask" call still unanswered (JSON lines of its transcript):
// its full questions and descriptions. The box folds a long question
// ("…", ^O to unfold) and only the 1st line of a description can be read there.
export interface OmpAsked { question: string, options: { label: string, description: string | null }[] }
export function pendingOmpAsk(lines: string[]): OmpAsked[] {
  const pending = new Map<string, OmpAsked[]>()
  for (const line of lines) {
    if (!line || !line.includes('"message"')) continue
    let d: Json
    try { d = JSON.parse(line) }
    catch { continue }
    const m = d && d.type === 'message' && d.message
    if (!m) continue
    if (m.role === 'toolResult') pending.delete(m.toolCallId)
    else if (m.role === 'assistant' && Array.isArray(m.content)) {
      for (const part of m.content) {
        if (!part || part.type !== 'toolCall' || part.name !== 'ask' || !part.id) continue
        const qs: Json[] = part.arguments && Array.isArray(part.arguments.questions) ? part.arguments.questions : []
        pending.set(part.id, qs.filter(q => q && typeof q.question === 'string').map(q => ({
          question: q.question.trim(),
          options: (Array.isArray(q.options) ? q.options : []).filter((o: Json) => o && typeof o.label === 'string')
            .map((o: Json) => ({ label: o.label, description: typeof o.description === 'string' && o.description.trim() ? o.description.trim() : null })),
        })))
      }
    }
  }
  return [...pending.values()].pop() || []
}

// On-screen question completed by the call: recognized by its start, ignoring
// whitespace (omp joins the question's lines on display).
export function completeOmpAsk(choices: Choices, asked: OmpAsked[]): Choices {
  const key = (s: string) => s.replace(/\s+/g, '')
  const shown = key((choices.question || '').replace(/…$/, ''))
  const q = shown && asked.find(a => key(a.question).startsWith(shown))
  if (!q) return choices
  const desc = new Map(q.options.map(o => [o.label, o.description]))
  return {
    ...choices,
    question: q.question,
    options: choices.options.map((o) => {
      const d = desc.get(o.label.replace(/ \(Recommended\)$/, ''))
      return d ? { ...o, hint: d } : o
    }),
  }
}

// On-screen prompt of a pane, re-read before answering it (choose, nav): the
// "Ask" box for omp, otherwise a numbered or unnumbered list.
export function screenChoices(text: string | null | undefined, agent: string | null | undefined): Choices | null {
  return agent === 'omp' ? parseOmpAsk(text) : parseChoices(text) || parseChoices(text, { strict: true })
}

// Visible input field = a "❯" (Claude) or "›" (Codex) line at the bottom of
// the screen. Some commands (/usage, /context all…) open a full-screen
// panel that hides it until Escape is pressed.
export function inputVisible(text: string | null | undefined): boolean {
  const lines = String(text || '').replace(/\s+$/, '').split('\n').slice(-12)
  return lines.some(l => /^\s*[❯›](\s|$)/.test(l))
}
