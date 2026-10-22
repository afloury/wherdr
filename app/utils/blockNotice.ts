// What a task waiting for you says, read for the one-line "Needs you" banner
// and the Board card: the kind of wait (`report --kind`), its links shortened,
// and the answers its agent offered.
import { prNumber } from '../../shared/projectsTasks'
import { tl } from './i18n'

export type BlockKind = 'question' | 'permission' | 'auth'

export function blockKind(kind: string | null | undefined): BlockKind | null {
  return kind === 'question' || kind === 'permission' || kind === 'auth' ? kind : null
}

export function blockKindLabel(kind: BlockKind): string {
  if (kind === 'question') return tl('Question', 'Question')
  if (kind === 'permission') return tl('Permission', 'Permission')
  return tl('Sign-in', 'Connexion')
}

// ------------------------------------------------------------------ links
export type TextPart = { text: string } | { text: string, href: string }

const URL_RE = /https?:\/\/[^\s<>"'`]+/g
// Closing punctuation after a link belongs to the sentence ("see https://x.)").
const TRAIL_RE = /[.,;:!?)\]}»”’]+$/

// A short name for a link: "PR #484" for a pull request, else its host and
// the end of its path.
export function linkLabel(href: string): string {
  const pr = prNumber(href)
  if (pr) return `PR ${pr}`
  try {
    const u = new URL(href)
    const path = u.pathname.replace(/\/+$/, '')
    const tail = path.split('/').filter(Boolean).slice(-2).join('/')
    const label = tail ? `${u.host}/${path.split('/').filter(Boolean).length > 2 ? '…/' : ''}${tail}` : u.host
    return label.length > 40 ? `${label.slice(0, 39)}…` : label
  } catch { return href }
}

export function textParts(text: string): TextPart[] {
  const parts: TextPart[] = []
  let at = 0
  for (const m of text.matchAll(URL_RE)) {
    let href = m[0]
    const trail = TRAIL_RE.exec(href)
    // A ")" closing a "(" of the link itself stays (wiki links).
    if (trail && !(trail[0].startsWith(')') && href.includes('('))) href = href.slice(0, -trail[0].length)
    if (!href.replace(/^https?:\/\//, '')) continue
    const start = m.index!
    if (start > at) parts.push({ text: text.slice(at, start) })
    parts.push({ text: linkLabel(href), href })
    at = start + href.length
  }
  if (at < text.length) parts.push({ text: text.slice(at) })
  return parts
}

// The message as one line, links shortened (a card's line).
export const shortText = (text: string) => textParts(text).map(p => p.text).join('').replace(/\s+/g, ' ').trim()

// The first pull request a message links to.
export function prLink(text: string): string {
  for (const p of textParts(text)) if ('href' in p && prNumber(p.href)) return p.href
  return ''
}

// ---------------------------------------------------------------- answers
// One answer the agent offered: its button's label, and what a click sends.
export interface BlockChoice { label: string, reply: string }

const MAX_CHOICES = 5
const MAX_LABEL = 80

const clean = (s: string) => s.replace(/\s+/g, ' ').replace(/^[\s,;:–—-]+/, '').replace(/(?:[\s,;:–—-]+|\s+(?:or|ou))+$/i, '').replace(/[?.!]+$/, '').trim()

// Numbered or lettered answers, in order from 1, a or A: "1) Keep 2) Drop",
// "A. Keep / B. Drop", one per line or inline.
function listed(msg: string): BlockChoice[] {
  for (const first of ['1', 'a', 'A']) {
    const marks: { at: number, end: number, mark: string }[] = []
    let want = first
    const re = /(^|[\s(:;,])([0-9]|[a-zA-Z])[).]\s+/g
    for (const m of msg.matchAll(re)) {
      if (m[2] !== want) continue
      const at = m.index! + m[1]!.length
      marks.push({ at, end: m.index! + m[0].length, mark: m[2]! })
      want = String.fromCharCode(want.charCodeAt(0) + 1)
    }
    if (marks.length < 2 || marks.length > MAX_CHOICES) continue
    const out = marks.map((k, i) => {
      const text = clean(msg.slice(k.end, i + 1 < marks.length ? marks[i + 1]!.at : undefined).split('\n')[0]!)
      return { label: text, reply: `${k.mark}) ${text}` }
    })
    if (out.every(c => c.label && c.label.length <= MAX_LABEL)) return out
  }
  return []
}

// Answers in a closing group: "Remove it? (yes/no)", "[keep | drop]".
function grouped(msg: string): BlockChoice[] {
  const m = /[([]([^()[\]\n]{1,160})[)\]]\s*[?.!:]?\s*$/.exec(msg.trim())
  if (!m) return []
  const inner = m[1]!.trim()
  if (/:\/\/|^(?:e\.g\.|ex\.|i\.e\.)/i.test(inner)) return []
  // A path ("src/app.ts", "~/dev") is not a choice.
  if (/^[~.]?[\w.-]*\/[\w./-]*$/.test(inner) && /[.~]|\/.*\//.test(inner)) return []
  const items = inner.split(/\s*[/|]\s*|\s+(?:or|ou)\s+/i).map(clean).filter(Boolean)
  if (items.length < 2 || items.length > MAX_CHOICES || items.some(s => s.length > 40)) return []
  return items.map(s => ({ label: s, reply: s }))
}

export function blockChoices(msg: string): BlockChoice[] {
  const list = listed(msg)
  return list.length ? list : grouped(msg)
}

// A permission its agent also offers to give for good.
// Only when "always" is offered as an answer, where the question ends: a
// choice of its closing group ("(yes / always / no)"), or its last words
// ("…, or always?", "ou toujours autoriser ?"). The word anywhere else
// describes something ("our policy is to always allow…") and offers nothing.
const ALWAYS_ITEM = /^(?:always|toujours)(?:\s+(?:allow|allowed|autoriser|autorisé))?$/i
const ALWAYS_LAST = /\b(?:or|ou)\s+(?:always|toujours)(?:\s+(?:allow|autoriser))?\s*[?.!]?\s*$/i
export function offersAlways(msg: string): boolean {
  if (grouped(msg).some(c => ALWAYS_ITEM.test(c.label))) return true
  return ALWAYS_LAST.test(msg.trim())
}

// What Allow, Refuse and Always allow send.
export function permissionReply(answer: 'allow' | 'refuse' | 'always'): string {
  if (answer === 'allow') return tl('Allowed: go ahead.', 'Autorisé : vas-y.')
  if (answer === 'refuse') return tl('Refused: do not do it.', 'Refusé : ne le fais pas.')
  return tl('Allowed, always: no need to ask again for this.', 'Autorisé, toujours : plus besoin de demander pour ça.')
}

// The conversation's message that asks it: the last agent message holding
// the start of the question, else its last agent message.
export function questionMessage(root: ParentNode, msg: string): HTMLElement | null {
  const all = [...root.querySelectorAll<HTMLElement>('.msg-ai')]
  if (!all.length) return null
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
  const head = norm(msg.split(/https?:\/\//)[0]!).slice(0, 40)
  if (head.length >= 8) {
    for (let i = all.length - 1; i >= 0; i--) if (norm(all[i]!.textContent || '').includes(head)) return all[i]!
  }
  return all[all.length - 1]!
}
