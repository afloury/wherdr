// "/" command sent from the conversation: should its result be shown
// ("❯ /cmd" panel, read from the terminal screen)?
//
// Only the agent's local commands (/usage, /context, /cost…) display
// a result on screen without replying. A skill or a custom command
// (/daily-log…) makes the agent work: normal user message, usual
// "agent is working" state, never the screen text ("✢ Roosting…").
import type { SlashCommand } from './types'

// Claude's activity line ("✢ Roosting… (3s · ↓ 1k tokens)", "* Working…"),
// reply ("⏺ …") or "esc to interrupt": the agent is replying, not an output.
const GLYPHS = '·✢✳✶✻✽✺✹✷✸*∗'
const ACTIVITY = new RegExp(`^\\s*[${GLYPHS}]\\s+\\p{L}[\\p{L}'’\\-]*(?: \\p{L}[\\p{L}'’\\-]*){0,3}(?:…|\\.\\.\\.)(?:\\s+\\(.*\\))?\\s*$`, 'u')
const REPLY = /^\s*[⏺●]\s+\S/
const INTERRUPT = /\besc to interrupt\b/i

// The catalog's skill / custom command ("daily-log" or "/daily-log").
export function isAgentCommand(cmd: string, catalog: readonly SlashCommand[]): boolean {
  const name = cmd.replace(/^\//, '').toLowerCase()
  return catalog.some(c => c.source !== 'builtin' && c.name.toLowerCase() === name)
}

// Below the "❯ /cmd" line (the last one), the agent is working or replying.
export function agentAnswering(screen: string, cmd: string): boolean {
  const lines = screen.replace(/\s+$/, '').split('\n')
  let start = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.includes(cmd) && /^\s*[❯›>]/.test(lines[i]!)) { start = i + 1; break }
  }
  // No command line (full-screen settings panel): a result.
  if (start < 0) return false
  return lines.slice(start).some(l => ACTIVITY.test(l) || REPLY.test(l) || INTERRUPT.test(l))
}
