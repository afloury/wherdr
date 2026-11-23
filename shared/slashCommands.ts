// The slash commands and skills of an agent, as the composer's "/" list shows them
// (GET /api/commands, server/utils/agentCommands.ts). Only omp and Claude Code can say
// what they have; every other agent keeps the plain field.
// The agents that can say what they have. A Codex source (its saved prompts, typed
// "/prompts:<name>") would join here and in server/utils/agentCommands.ts: `name` is always what
// follows the "/", so it needs no change of shape.
export type SlashAgent = 'omp' | 'claude'
export type SlashKind = 'command' | 'skill' | 'prompt'

export interface SlashCommand {
  // What follows the "/" ("compact", "skill:retro", "figma:figma-use").
  name: string
  // The other names the agent accepts for it.
  aliases?: string[]
  desc?: string
  // What it takes after its name ("<path>", "[focus]").
  hint?: string
  kind: SlashKind
}

export interface SlashList {
  agent: SlashAgent | null
  commands: SlashCommand[]
  // The agent could not be asked: not installed there, its machine unreachable, or no answer.
  error?: 'not_installed' | 'unreachable' | 'unavailable'
}

export const hasSlashList = (agent: string | null | undefined): agent is SlashAgent => agent === 'omp' || agent === 'claude'
