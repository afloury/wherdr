import { isRefLine } from '../../shared/reference'
import type { KeyInfo } from './cardKeys'

export const PROMPT_HISTORY_MAX = 100
export interface HistoryDraft { text: string, start: number, end: number }

// Only the field's own words: attachments live separately, references are lines.
export const historyText = (text: string) => text.split('\n').filter(line => !isRefLine(line)).join('\n').trim()

export function addPromptHistory(entries: string[], text: string): string[] {
  const plain = historyText(text)
  if (!plain || entries.at(-1) === plain) return entries
  return [...entries, plain].slice(-PROMPT_HISTORY_MAX)
}

// Selection, modified arrows and IME belong to the editor. Newlines delimit
// logical lines; a long line wrapped by the field is still one history line.
export function historyDirection(e: KeyInfo & { keyCode?: number }, draft: HistoryDraft): -1 | 1 | null {
  if (e.defaultPrevented || e.isComposing || e.keyCode === 229 || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || draft.start !== draft.end) return null
  if (e.key === 'ArrowUp' && !draft.text.slice(0, draft.start).includes('\n')) return -1
  if (e.key === 'ArrowDown' && !draft.text.slice(draft.end).includes('\n')) return 1
  return null
}

export class PromptHistory {
  private snapshot: string[] = []
  private index = 0
  draft: HistoryDraft | null = null

  reset() { this.draft = null; this.snapshot = []; this.index = 0 }

  move(direction: -1 | 1, current: HistoryDraft, entries: string[]): HistoryDraft | null {
    if (!this.draft) {
      if (direction === 1 || !entries.length) return null
      this.draft = { ...current }
      this.snapshot = [...entries]
      this.index = entries.length
    }
    const index = Math.max(0, this.index + direction)
    if (index === this.index) return null
    if (index >= this.snapshot.length) {
      const original = this.draft
      this.reset()
      return original
    }
    this.index = index
    const text = this.snapshot[index]!
    return { text, start: text.length, end: text.length }
  }
}
