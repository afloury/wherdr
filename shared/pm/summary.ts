// A few lines on how a task went, written by a cheap model (Haiku) from the
// reports and verdicts the task keeps, once per round: a new report or verdict
// is a new round. Only those texts go out, their private-looking parts masked.
import { taskHistory } from './history'
import { maskLeaks } from './visibility'
import type { StepState } from './steps'

export interface TaskSummary { round: number, text: string, at: number }

const ROUND = new Set(['Done', 'Fixed', 'Sent back', 'Passed'])
const INPUT_MAX = 12_000
const WHO = { worker: 'Worker', reviewer: 'Reviewer', user: 'User', coordinator: 'Coordinator', engine: 'wherdr' } as const

export const SUMMARY_PROMPT = [
  'Summarize how this software task went, in 3 to 6 short lines of plain Markdown:',
  'what was built, the main review findings and how they were solved, what is left.',
  'Use only the text below. No heading, no preamble, no file contents.',
].join(' ')

type Source = { title: string, log?: { at: number, by: string, text: string }[], step?: StepState }

// The task's round (its reports and verdicts so far), what was last added
// and the text the model reads; null: no report or verdict yet.
export function summarySource(task: Source, plan: { id: string }[]): { round: number, last: number, input: string } | null {
  const entries = taskHistory(task.log ?? [], plan, task.step).filter(e => ROUND.has(e.label))
  if (!entries.length) return null
  const text = [`Task: ${task.title}`, ...entries.map(e => `## ${WHO[e.who]}: ${e.label}\n\n${e.text}`)].join('\n\n')
  // The newest kept when it is too long.
  return { round: entries.length, last: entries.at(-1)!.at, input: maskLeaks(text.length > INPUT_MAX ? text.slice(-INPUT_MAX) : text) }
}

export const summaryPrompt = (input: string) => `${SUMMARY_PROMPT}\n\n---\n\n${input}`

// The model's answer, kept short: at most 6 lines, 800 characters.
export const cleanSummary = (out: string) =>
  out.trim().split('\n').filter(l => l.trim()).slice(0, 6).join('\n').slice(0, 800).trim()
