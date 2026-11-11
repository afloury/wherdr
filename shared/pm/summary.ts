// The TL;DR under To do: a few lines for the user to decide, written by a cheap
// model (Haiku) from the task's title, description, reports and verdicts, the
// files it changed with their line counts (no contents), its step and what its
// Merge does. Written again only on a significant change: new commits of its
// own (not a merge of the base, a rebase or a CI re-run), new findings, or a
// first verdict on them. Everything that goes out is masked.
import { taskHistory, REPORTS } from './history'
import { maskLeaks } from './visibility'
import { isPrMerge } from './workflow'
import type { PlannedStep, StepState } from './steps'
import type { Task } from './run'

// key: what the TL;DR was written for (tldrSource).
export interface TaskTldr { key: string, text: string, at: number }

const INPUT_MAX = 12_000
const WHO = { worker: 'Worker', reviewer: 'Reviewer', user: 'User', coordinator: 'Coordinator', engine: 'wherdr' } as const

export const TLDR_PROMPT = [
  'Write a TL;DR of this software task for its owner, who must now decide on it (merge it or send it back).',
  'In 3 to 6 short lines of plain Markdown, only what they need to decide: what changed for the user, how it was checked,',
  'the review findings fixed or left, the risks, what the screenshots show when the reports say, what the Merge does (which branch it goes to).',
  'Use only the text below. No heading, no preamble, no file contents.',
].join(' ')

type Source = Pick<Task, 'title' | 'description' | 'log' | 'work'> & { step?: StepState }

// What the Merge does, from the plan's step that merges (the user's button, or wherdr on its own).
const MERGES = new Set(['github.merge', 'bitbucket.merge', 'git.land', 'git.verify-merged'])
export function mergeText(plan: PlannedStep[]): string {
  const s = plan.find(p => p.action && MERGES.has(p.action.kind)), a = s?.action
  if (!s || !a) return 'No merge step: the user merges by hand.'
  const who = s.ends === 'user' ? `The user's "${s.userLabel || 'Merge'}"` : 'wherdr', into = plan.find(p => p.action?.kind === 'github.pr')?.action?.base
  if (isPrMerge(a.kind)) return `${who} merges the PR${into ? ` into ${into}` : ''}${a.method ? ` (${a.method})` : ''}.`
  if (a.kind === 'git.land') return `${who} merges the branch into ${a.target ?? 'its base'}.`
  return `The user merges the PR into ${a.target ?? 'its base'} on the Git host; "${s.userLabel || 'Merged'}" checks it.`
}

// The key of what the TL;DR says (its own commits, the findings, reviewed or
// not) and the text the model reads; null: no report or verdict yet.
export function tldrSource(task: Source, plan: PlannedStep[]): { key: string, last: number, input: string } | null {
  const entries = taskHistory(task.log ?? [], plan, task.step).filter(e => REPORTS.has(e.label))
  if (!entries.length) return null
  const s = task.step
  const findings = [...Object.values(s?.reviews ?? {}).flat().flatMap(r => r.findings), ...Object.values(s?.minor ?? {}).flat()].map(f => f.id).sort()
  const key = [task.work?.commits ?? '', findings.join(','), entries.at(-1)!.who === 'reviewer' ? 'reviewed' : ''].join('|')
  const files = task.work?.files ?? []
  const head = [
    `Task: ${task.title}`,
    `Step: ${s?.done ? 'done' : plan[s?.at ?? 0]?.id ?? '?'}. ${mergeText(plan)}`,
    task.description ? `## Description\n\n${task.description.slice(0, 2000)}` : '',
    files.length ? `## Changed files\n\n${files.slice(0, 60).map(f => `- ${f.path} +${f.add} -${f.del}`).join('\n')}${files.length > 60 ? `\n- … ${files.length - 60} more` : ''}` : '',
  ].filter(Boolean).join('\n\n')
  // The newest reports kept when it is too long.
  const reports = entries.map(e => `## ${WHO[e.who]}: ${e.label}\n\n${e.text}`).join('\n\n')
  const room = Math.max(INPUT_MAX - head.length, 2000)
  return { key, last: entries.at(-1)!.at, input: maskLeaks(`${head}\n\n${reports.length > room ? reports.slice(-room) : reports}`) }
}

export const tldrPrompt = (input: string) => `${TLDR_PROMPT}\n\n---\n\n${input}`

// The model's answer, kept short: at most 8 lines, 1000 characters.
export const cleanTldr = (out: string) =>
  out.trim().split('\n').filter(l => l.trim()).slice(0, 8).join('\n').slice(0, 1000).trim()
