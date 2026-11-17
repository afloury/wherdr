// The answers of a `questions` card (utils/markdown.ts, QuestionsCard.vue) as
// the one message it sends, and back: `1A Postgres · 2 my own words · 3 skip`.
// Each answer starts with the question's number, then the option's letter
// when one was picked (readable as "1A 2B" too); a question left unanswered
// is sent as `skip`. A `·` in an answer (typed, or in an option) is sent as
// `•`, so that ` · ` only ever separates answers and the reply reads back.
import type { WherdrQuestion } from './markdown'

// The option picked (its index), or the words typed instead.
export type QuestionPick = { option: number } | { text: string } | null
export const SKIP = 'skip'
const SEP = ' · '
export const optionLetter = (i: number) => String.fromCharCode(65 + i)
const clean = (text: string) => text.replace(/·/g, '•').replace(/\s+/g, ' ').trim()

export function questionsReply(items: WherdrQuestion[], picks: QuestionPick[]): string {
  return items.map((q, i) => {
    const p = picks[i]
    if (p && 'option' in p && q.options[p.option] !== undefined) return `${i + 1}${optionLetter(p.option)} ${clean(q.options[p.option]!)}`
    const text = p && 'text' in p ? clean(p.text) : ''
    return `${i + 1} ${text || SKIP}`
  }).join(SEP)
}

// A sent reply read back, so that an answered card shows what was given.
export function readQuestionsReply(items: WherdrQuestion[], reply: string): QuestionPick[] {
  const picks: QuestionPick[] = items.map(() => null)
  for (const part of reply.replace(/\s+/g, ' ').split(SEP)) {
    const m = /^\s*(\d+)([A-D])?\s+(.*?)\s*$/.exec(part)
    const i = m ? Number(m[1]) - 1 : -1
    if (!m || !items[i] || picks[i]) continue
    const option = m[2] ? m[2].charCodeAt(0) - 65 : items[i]!.options.findIndex(o => clean(o).toLowerCase() === m[3]!.toLowerCase())
    if (option >= 0 && option < items[i]!.options.length) picks[i] = { option }
    else if (m[3] && m[3].toLowerCase() !== SKIP) picks[i] = { text: m[3] }
  }
  return picks
}

// What a view gives its `questions` cards (provided by ChatView and
// ReviewQuestion, injected in ChatMarkdown): for the card's place, whether it
// can be answered and the reply it got; and sending the reply.
export interface QuestionsHost {
  state: (el: HTMLElement) => { live: boolean, given: string | null }
  send: (el: HTMLElement, text: string) => void
}
export const QUESTIONS_HOST = 'questionsHost'
