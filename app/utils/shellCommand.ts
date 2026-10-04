// Commands an agent proposes in its reply, for the Copy and Run buttons: a
// shell code block (```bash, ```console, or no language but command lines)
// and inline code that reads as a command (`! gh pr merge 5`, `$ make`,
// `npm test`). The command is returned without the prompt the agent wrote
// in front of it ("! " for Claude Code's shell mode, "$ ", "❯ "), and a
// console transcript keeps its prompted lines only (the rest is output).
import { codeKind } from './codeKind'

const SHELL_LANGS: Record<string, true> = { bash: true, sh: true, zsh: true, shell: true, console: true, shellsession: true }
// "! cmd", "!cmd", "$ cmd", "❯ cmd"; never "$VAR" or "!=".
const PROMPT = /^\s*(?:!(?=\s*[^\s=])\s*|\$\s+|❯\s+)/

// Prompted lines and the lines they continue (trailing "\"); every line when
// none is prompted. Blank lines around the command are dropped.
function commandLines(lines: string[]): string | null {
  const prompted = lines.some(l => PROMPT.test(l))
  const out: string[] = []
  let cont = false
  for (const line of lines) {
    if (!prompted || cont) out.push(line)
    else if (PROMPT.test(line)) out.push(line.replace(PROMPT, ''))
    else continue
    cont = prompted && /\\\s*$/.test(line)
  }
  const text = out.join('\n').replace(/^\s*\n|\s+$/g, '')
  return text.trim() ? text : null
}

// Command of a fenced code block, or null when it is not a shell command.
export function blockCommand(code: string, lang?: string | null): string | null {
  const l = String(lang || '').trim().split(/\s/)[0]!.toLowerCase()
  const lines = String(code || '').split('\n')
  if (SHELL_LANGS[l]) return commandLines(lines)
  if (l) return null
  // No language: every logical line (continuations joined, comments left
  // out) must read as a command, unless the lines carry a prompt.
  const text = commandLines(lines)
  if (!text) return null
  if (lines.some(line => PROMPT.test(line))) return text
  const cmds = text.replace(/\\\s*\n/g, ' ').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
  return cmds.length && cmds.every(c => codeKind(c) === 'cmd' && !c.startsWith('/')) ? text : null
}

// Command of an inline code span, or null.
export function inlineCommand(code: string): string | null {
  const s = String(code || '').trim()
  if (!s || s.includes('\n')) return null
  const m = s.match(/^([!$❯])(\s*)(.+)$/)
  if (m) {
    const rest = m[3]!.trim()
    // "! cmd" / "$ cmd" are commands as written; "!cmd" only when cmd reads as one.
    if (m[2]) return rest
    return m[1] === '!' && codeKind(rest) === 'cmd' && !rest.startsWith('/') ? rest : null
  }
  // Slash commands (`/compact`) are the agent's, not the shell's.
  return codeKind(s) === 'cmd' && !s.startsWith('/') ? s : null
}

// Agents whose input runs "!"-prefixed text as a shell command in their own
// terminal: Claude Code (bash mode), Codex and omp ("$" is omp's Python).
const BANG_AGENTS: Record<string, true> = { claude: true, codex: true, omp: true }
export const canRunCommands = (agent: string | null | undefined) => Boolean(BANG_AGENTS[agent || ''])

// Message that runs the command in the agent's shell mode, or null when the
// agent has none.
export function runMessage(agent: string | null | undefined, cmd: string): string | null {
  const c = cmd.trim()
  return c && canRunCommands(agent) ? `! ${c}` : null
}
