// The built-ins an agent keeps to its own screen, which neither agent's command listing
// reports (see agentCommands.ts): a short, hand-kept list of the ones people actually use, merged
// after the agent's own list. Not parsed from the installed program: a new version's commands
// appear in the agent's own list; this one is only reviewed when an agent renames one of these.
// A Codex list would be a third entry here (its built-ins, not its saved prompts).
import type { SlashAgent, SlashCommand } from '../../shared/slashCommands'

const command = (name: string, desc: string, hint?: string): SlashCommand => ({ name, kind: 'command', desc, hint })

export const BUILTIN_COMMANDS: Record<SlashAgent, SlashCommand[]> = {
  // Names checked against omp 19's docs (session-operations-export-share-fork-resume.md for
  // /new /clear /resume /restart, compaction.md for /compact, collab.md for /help /hotkeys
  // /settings /exit).
  omp: [
    command('clear', 'Clear the conversation context'),
    command('new', 'Start a new conversation'),
    command('resume', 'Resume an earlier conversation', '[id]'),
    command('restart', 'Relaunch omp, keeping the session'),
    command('compact', 'Compact the conversation', '[focus]'),
    command('settings', 'Open the settings'),
    command('help', 'Show help and the available commands'),
    command('hotkeys', 'Show the keyboard shortcuts'),
    command('exit', 'Exit omp'),
  ],
  // Names and descriptions checked against https://code.claude.com/docs/en/commands (Claude Code 2.1).
  claude: [
    command('clear', 'Start a new conversation with empty context'),
    command('resume', 'Resume an earlier conversation', '[session]'),
    command('compact', 'Summarize the conversation to free up context', '[instructions]'),
    command('help', 'Show help and the available commands'),
    command('permissions', 'Manage the allow, ask and deny rules for tools'),
    command('config', 'Open the settings'),
    command('rewind', 'Rewind the conversation or the code to an earlier point'),
    command('status', 'Show the version, model, account and connectivity'),
    command('exit', 'Exit Claude Code'),
  ],
}

// The agent's own entries come first and win: a built-in is added only when no entry of the
// agent has its name, or one of its aliases.
export function withBuiltins(agent: SlashAgent, own: SlashCommand[]): SlashCommand[] {
  const taken = new Set(own.flatMap(c => [c.name, ...(c.aliases ?? [])]))
  return [...own, ...BUILTIN_COMMANDS[agent].filter(c => !taken.has(c.name))]
}
