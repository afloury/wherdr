// The slash commands and skills an omp or Claude Code terminal really has, asked of the agent
// itself: which skills it loaded (user and project folders, imported Claude folders, plugins),
// which commands, MCP prompts and built-ins it offers is only known to the agent that runs.
//  - omp: `omp --mode rpc` answers the `get_available_commands` request;
//  - Claude Code: `claude -p --input-format stream-json` answers the `initialize` control
//    request (the listing its SDK reads).
// Neither is a model call: no turn, no cost, no conversation file. Both run on the terminal's
// machine (machine.exec, so a remote machine answers for itself), in the terminal's folder
// (its project skills and commands count), with the PATH the machine's terminals have.
// What the agent keeps to its own screen (omp's /new, /resume, /settings…, Claude's /resume,
// /permissions, /help…) is in neither listing: a short hand-kept list (agentBuiltins.ts) follows
// the agent's own, which wins on a clash. Not covered: a project's file-based commands when
// the folder is gone.
import type { Pane } from '../../shared/types'
import type { SlashAgent, SlashCommand, SlashKind, SlashList } from '../../shared/slashCommands'
import { hasSlashList } from '../../shared/slashCommands'
import { USER_PATH_SETUP } from './agentAvailability'
import { coreShell, machineOfAddress } from './coreTranscripts'
import { withBuiltins } from './agentBuiltins'
import { HerdrError } from './herdr'
import type { ShellExec } from './fsx'

type Call = <T>(method: string, params: object, timeout: number) => Promise<T>
export interface AgentCommandsDeps {
  call: Call
  pane: (id: string) => Pane | undefined
  now?: () => number
}

type Agent = SlashAgent

// Both agents start slowly on a cold machine (settings sync, extensions): well beyond the ~1 s of a warm one.
const TIMEOUT_MS = 25_000
const MAX_BYTES = 4 * 1024 * 1024
// A listing is kept this long per machine, agent and folder; a failure for less, so a missing
// install or a sleeping machine is tried again soon.
const OK_TTL_MS = 60_000
const FAIL_TTL_MS = 10_000
const MAX_ENTRIES = 100
const MAX_DESC = 240

const REQUEST_ID = 'cmds'
const REQUEST: Record<Agent, string> = {
  omp: `{"id":"${REQUEST_ID}","type":"get_available_commands"}\n`,
  claude: `{"type":"control_request","request_id":"${REQUEST_ID}","request":{"subtype":"initialize"}}\n`,
}

// The terminal's PATH (the one its agent was found on), mise's shims after it. The terminal's
// identity stays out: an agent's integration hooks would report this run as the terminal's
// session. $1 is the terminal's folder (the home folder when it is gone).
const HEAD = `${USER_PATH_SETUP}
PATH="$PATH:$HOME/.local/share/mise/shims"; export PATH
for v in $(env | cut -d= -f1 | grep -E '^(HERDR|HC)_[A-Za-z0-9_]*$'); do unset "$v"; done
unset CLAUDECODE
[ -n "$1" ] && cd "$1" 2>/dev/null || cd "$HOME" || exit 3
`
// Only the answer line is kept (the rest is the agent's startup chatter: tens of KB).
// Claude: no hooks of the user's settings (the integration of a terminal manager among them),
// no MCP servers, no self-update, no conversation kept.
// omp: --no-extensions keeps the user's hooks and extensions out (project and user command files,
// skills and rules still load). omp has no switch for its MCP servers, so those start and their
// prompts are listed: the one thing here that Claude's --strict-mcp-config does not match.
const SCRIPT: Record<Agent, string> = {
  omp: `${HEAD}command -v omp >/dev/null 2>&1 || exit 127
DISABLE_AUTOUPDATER=1 omp --mode rpc --no-session --no-extensions 2>/dev/null | grep -a '"type":"response"'`,
  claude: `${HEAD}command -v claude >/dev/null 2>&1 || exit 127
DISABLE_AUTOUPDATER=1 claude -p --input-format stream-json --output-format stream-json --verbose --no-session-persistence --settings '{"disableAllHooks":true}' --strict-mcp-config 2>/dev/null | grep -a '"type":"control_response"'`,
}

const objects = (stdout: string): Record<string, unknown>[] => stdout.split('\n').flatMap((line) => {
  if (!line.startsWith('{')) return []
  try { return [JSON.parse(line) as Record<string, unknown>] } catch { return [] }
})
const asRecord = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null)
// What follows the "/": one word (a path starts with "/").
const validName = (v: unknown): v is string => typeof v === 'string' && /^[^\s/]+$/.test(v)
// One line of plain text: no markdown emphasis, bounded.
function text(v: unknown, max = MAX_DESC): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.replace(/\*\*|`/g, '').replace(/\s+/g, ' ').trim()
  if (!s) return undefined
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s
}

function finish(list: SlashCommand[]): SlashCommand[] {
  const seen = new Set<string>()
  return list.filter(c => !seen.has(c.name) && Boolean(seen.add(c.name)))
}

function aliasesOf(v: unknown, name: string): string[] | undefined {
  const names = Array.isArray(v) ? v.filter(validName).filter(a => a !== name).slice(0, 8) : []
  return names.length ? names : undefined
}

// omp: `{"type":"response","command":"get_available_commands","data":{"commands":[{name,
// description,input:{hint},aliases,source}]}}`. Skills are listed as "skill:<name>" (what is
// typed), MCP prompts as "<server>:<prompt>".
export function parseOmpCommands(stdout: string): SlashCommand[] | null {
  for (const m of objects(stdout)) {
    if (m.type !== 'response' || m.id !== REQUEST_ID) continue
    const list = asRecord(m.data)?.commands
    if (m.success !== true || !Array.isArray(list)) return null
    return finish(list.flatMap((entry): SlashCommand[] => {
      const c = asRecord(entry)
      if (!c || !validName(c.name)) return []
      const source = c.source
      const kind: SlashKind = source === 'skill' ? 'skill' : source === 'mcp_prompt' ? 'prompt' : 'command'
      // Custom commands all say "arguments": nothing to learn from it.
      const hint = text(asRecord(c.input)?.hint, 60)
      return [{ name: c.name, kind, aliases: aliasesOf(c.aliases, c.name), desc: text(c.description), hint: hint === 'arguments' ? undefined : hint }]
    }))
  }
  return null
}

// A Claude description starts with the plugin ("(figma) …") or ends with where the command
// lives ("… (user)", "… (project)", "… (claude.ai sync)"): that is not what it does.
function claudeDescription(name: string, raw: string): string | undefined {
  const plugin = name.includes(':') ? name.slice(0, name.indexOf(':')) : ''
  let d = raw
  if (plugin && d.startsWith(`(${plugin}) `)) d = d.slice(plugin.length + 3)
  return text(d.replace(/ \((?:user|project|local|managed|claude\.ai sync)\)$/, ''))
}

// Claude Code: `{"type":"control_response","response":{"subtype":"success","request_id":…,
// "response":{"commands":[{name,description,argumentHint,builtin,aliases}]}}}`. Skills and
// custom commands are one list there; the built-ins say so.
export function parseClaudeCommands(stdout: string): SlashCommand[] | null {
  for (const m of objects(stdout)) {
    const r = m.type === 'control_response' ? asRecord(m.response) : null
    if (!r || r.request_id !== REQUEST_ID) continue
    const list = asRecord(r.response)?.commands
    if (r.subtype !== 'success' || !Array.isArray(list)) return null
    return finish(list.flatMap((entry): SlashCommand[] => {
      const c = asRecord(entry)
      if (!c || !validName(c.name) || c.name.startsWith('_')) return []
      const raw = typeof c.description === 'string' ? c.description : ''
      // Commands of the agent's own machinery (a removed one, those only a managed session runs).
      if (raw.startsWith('(removed)') || /sessions only\)$/.test(raw)) return []
      return [{
        name: c.name, kind: c.builtin === true ? 'command' : 'skill', aliases: aliasesOf(c.aliases, c.name),
        desc: claudeDescription(c.name, raw), hint: text(c.argumentHint, 60),
      }]
    }))
  }
  return null
}

const PARSE: Record<Agent, (stdout: string) => SlashCommand[] | null> = { omp: parseOmpCommands, claude: parseClaudeCommands }

async function ask(exec: ShellExec, agent: Agent, cwd: string): Promise<SlashList> {
  const r = await exec(SCRIPT[agent], [cwd], { input: Buffer.from(REQUEST[agent]), timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES })
  const commands = r.code === 127 ? null : PARSE[agent](r.stdout.toString('utf8'))
  if (commands) return { agent, commands: withBuiltins(agent, commands) }
  // 127: not on the machine's PATH; 255: the machine (or herdr-core) did not answer (see coreShell).
  return { agent, commands: [], error: r.code === 127 ? 'not_installed' : r.code === 255 ? 'unreachable' : 'unavailable' }
}

export interface AgentCommands {
  list: (paneId: string) => Promise<SlashList>
}

export function createAgentCommands(deps: AgentCommandsDeps): AgentCommands {
  const now = deps.now ?? Date.now
  // Settled answers by machine, agent and folder; `ttl` is unbounded while one is being asked
  // (a second request waits for it instead of starting the agent again).
  const entries = new Map<string, { at: number, ttl: number, list: Promise<SlashList> }>()

  async function list(paneId: string): Promise<SlashList> {
    const p = deps.pane(paneId)
    if (!p?.coreAddress) throw new HerdrError('bad_pane', 'Pane not found')
    if (!hasSlashList(p.agent)) return { agent: null, commands: [] }
    const agent = p.agent
    const machine = machineOfAddress(p.coreAddress)
    const cwd = p.cwd || ''
    const key = [machine, agent, cwd].join('\0')
    const hit = entries.get(key)
    if (hit && now() - hit.at < hit.ttl) return hit.list
    // `coreShell` without a machine name runs on the machine of herdr-core itself.
    const asked = ask(coreShell(deps.call, machine), agent, cwd).catch((): SlashList => ({ agent, commands: [], error: 'unavailable' }))
    const entry = { at: now(), ttl: Infinity, list: asked }
    void entry.list.then((l) => { entry.at = now(); entry.ttl = l.error ? FAIL_TTL_MS : OK_TTL_MS })
    entries.delete(key)
    entries.set(key, entry)
    if (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!)
    return entry.list
  }
  return { list }
}
