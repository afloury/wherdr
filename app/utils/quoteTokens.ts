// Quotes in the message field (Settings › Conversation, "Quoted replies").
// The draft text stays the one of utils/questionReply.ts — each quoted
// question or passage as "> " lines, its answer below — so sending, the draft
// kept per conversation and the "Quoted" buttons do not change. Only the
// field's drawing differs, by mode:
//   lines:  the plain field, "> " lines as typed (default);
//   native: the same native textarea, its "> " lines drawn as tokens by a
//           mirror behind it (utils/quoteMirror.ts);
//   rich:   a rich field (components/QuoteTokensField.vue) where each run of
//           "> " lines is one compact, non-editable token.

import { QUOTE_LINE } from './questionReply'

export const QUOTE_MODES = ['lines', 'native', 'rich'] as const
export type QuoteMode = typeof QUOTE_MODES[number]

// The saved mode of one device kind. Before the choice, a switch per device
// (`legacy`, "1" = on) turned the rich field on: it keeps it.
export function readQuoteMode(saved: string | null, legacy: string | null): QuoteMode {
  if (QUOTE_MODES.includes(saved as QuoteMode)) return saved as QuoteMode
  return legacy === '1' ? 'rich' : 'lines'
}

// What the field shows for a draft: a line of text, or a token for a run of
// "> " lines (its text, one line per quoted line).
export type FieldItem = { kind: 'line', text: string } | { kind: 'token', text: string }

export function fieldItems(draft: string): FieldItem[] {
  const out: FieldItem[] = []
  for (const line of String(draft ?? '').split('\n')) {
    const m = QUOTE_LINE.exec(line)
    const last = out.at(-1)
    if (m && last?.kind === 'token') last.text += `\n${m[2]}`
    else if (m) out.push({ kind: 'token', text: m[2]! })
    else out.push({ kind: 'line', text: line })
  }
  return out
}

// Minimal view of the field's DOM, so that the reading can be tested.
export interface FieldNode {
  nodeType: number
  nodeName: string
  data?: string
  childNodes: ArrayLike<FieldNode>
}

const BLOCKS = /^(DIV|P|LI|UL|OL|BLOCKQUOTE|PRE|H[1-6])$/

// Draft text of the field: block elements and <br> are line breaks (a <br>
// that ends a block only gives the block its height), a token gives its
// "> " lines, everything else is plain text. `tokenText` returns the text of
// a token element, null for any other element.
export function readField(root: FieldNode, tokenText: (el: FieldNode) => string | null): string {
  const lines: string[] = []
  let cur: string | null = null
  const flush = () => {
    if (cur !== null) lines.push(cur)
    cur = null
  }
  const visit = (node: FieldNode, parent: FieldNode | null, index: number) => {
    if (node.nodeType === 3) {
      const parts = (node.data || '').split('\n')
      cur = (cur ?? '') + parts[0]
      for (const part of parts.slice(1)) {
        lines.push(cur)
        cur = part
      }
      return
    }
    if (node.nodeType !== 1) return
    const quote = tokenText(node)
    if (quote !== null) {
      flush()
      for (const l of quote.split('\n')) lines.push(`> ${l}`)
      return
    }
    if (node.nodeName === 'BR') {
      const lastInBlock = Boolean(parent && index === parent.childNodes.length - 1)
      if (lastInBlock) cur ??= ''
      else {
        lines.push(cur ?? '')
        cur = ''
      }
      return
    }
    const block = BLOCKS.test(node.nodeName)
    if (block) {
      flush()
      if (!node.childNodes.length) lines.push('')
    }
    for (let i = 0; i < node.childNodes.length; i++) visit(node.childNodes[i]!, node, i)
    if (block) flush()
  }
  for (let i = 0; i < root.childNodes.length; i++) visit(root.childNodes[i]!, root, i)
  flush()
  return lines.join('\n')
}

// Enter in the field, like the plain field: sends where Enter sends
// (computer keyboard), otherwise a new line; Shift+Enter and an IME
// composition always stay a new line.
export function enterAction(e: { key: string, shiftKey: boolean, isComposing: boolean }, enterSends: boolean): 'send' | 'newline' | null {
  if (e.key !== 'Enter') return null
  return enterSends && !e.shiftKey && !e.isComposing ? 'send' : 'newline'
}
