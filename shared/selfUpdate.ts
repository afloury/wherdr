import { launchOptions, type RestartPlan } from './restart'
import type { Choices } from './types'

export type UpdateChoice = 'restart' | 'resume' | 'fresh'
export interface UpdateLaunch {
  argv: string[] | null
  session: string | null
  conversation: 'empty' | 'existing' | 'unknown'
}

// Only the installer's final output, immediately followed by a shell prompt.
// Quoted text, a running TUI and a partially typed shell command are rejected.
export function updateShellSignature(text: string): string | null {
  const lines = text.replace(/\r/g, '').trimEnd().split('\n')
  const end = lines.findLastIndex(l => /^\s*(?:🎉\s*)?Update ran successfully! Please restart Codex\.\s*$/.test(l))
  if (end < 0 || !lines.slice(Math.max(0, end - 4), end).some(l => /^\s*Codex CLI \S+ installed successfully\.\s*$/.test(l))) return null
  const tail = lines.slice(end + 1).filter(l => l.trim())
  if (!tail.length || tail.length > 2) return null
  // Conservative: unfamiliar prompts require a manual relaunch in the terminal.
  const last = tail.at(-1)!
  // `>` is a continuation prompt (quotes, heredocs), never a fresh input.
  if (!/^\s*(?:[\w@./~:-]+(?: [\w@./~:-]+){0,2} )?[$%#❯]\s*$/.test(last)) return null
  // Only a known two-line prompt heading is accepted. Arbitrary preceding
  // text could be a command already entered before the first exit sample.
  if (tail.length === 2 && (!/^\s*[\w./~:-]+ on [\w./:-]+\s*$/.test(tail[0]!) || !/^\s*❯\s*$/.test(last))) return null
  return tail.join('\n')
}

export function updateChoices(launch: UpdateLaunch): UpdateChoice[] {
  return launch.conversation === 'empty' && launch.argv && !launch.argv.some(a => a === 'resume' || a === 'fork')
    ? ['restart'] : ['resume', 'fresh']
}
export const UPDATE_LABELS: Record<UpdateChoice, string> = {
  restart: 'Restart Codex', resume: 'Resume conversation', fresh: 'Start fresh',
}
export function updatePrompt(launch: UpdateLaunch): Choices {
  return { kind: 'self-update', question: 'Codex updated itself and stopped', cursor: -1,
    options: updateChoices(launch).map(c => ({ label: UPDATE_LABELS[c], hint: c === 'resume' && !launch.session ? 'Choose a conversation in Codex' : null })) }
}
export function updateRestartPlan(launch: UpdateLaunch, choice: UpdateChoice): RestartPlan {
  const kept = launch.argv ? launchOptions('codex', launch.argv).kept.flat() : []
  // Never use --last: another pane may have created a newer conversation.
  // With no exact session, open Codex's picker and let the user select one.
  let args = choice === 'resume' ? ['resume', ...kept, ...(launch.session ? [launch.session] : [])] : kept
  if (choice === 'restart' && launch.argv) {
    const i = launch.argv.findIndex(a => /(?:^|\/)codex(?:\.[cm]?js)?$/.test(a))
    if (i >= 0) args = launch.argv.slice(i + 1)
  }
  return { args, mode: choice === 'resume' ? 'resume' : 'fresh', kept, dropped: [], unknownArgs: !launch.argv }
}
