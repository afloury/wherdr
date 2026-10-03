// Restart an agent in its pane (Claude Code update…) while keeping
// its conversation. Pure logic, shared by the server and the tests:
// - which original launch options to carry over (process argv read by
//   `pane.process_info`);
// - which relaunch command (`claude --resume <id>`, `codex resume <id>`…).
//
// Checked with Claude Code 2.1: `claude --resume <id>` restores the model,
// but neither the effort nor the permission mode (plan -> default mode): the
// original options are therefore replayed. A session without any message has no
// transcript and `--resume` fails ("No conversation found"): the agent
// then starts fresh, with its options.

export type RestartMode = 'resume' | 'continue' | 'fresh'
export type RestartPhase = 'stopping' | 'updating' | 'starting' | 'failed'

export interface RestartPlan {
  // Arguments passed to `agent.start` (after the executable).
  args: string[]
  mode: RestartMode
  // Original options carried over as is (shown in the confirmation).
  kept: string[]
  // Original options not carried over (unknown or specific to the first launch).
  dropped: string[]
  // Original command line not found: relaunch with default settings.
  unknownArgs: boolean
}

// Number of values of an option: 1 = one value, '*' = one or more
// (up to the next option), '?' = optional value.
type Arity = 0 | 1 | '*' | '?'
interface FlagSpec { keep: Record<string, Arity>, drop: Record<string, Arity> }

const CLAUDE: FlagSpec = {
  keep: {
    '--model': 1, '--effort': 1, '--permission-mode': 1, '--fallback-model': 1,
    '--agent': 1, '--agents': 1, '--settings': 1, '--setting-sources': 1,
    '--system-prompt': 1, '--append-system-prompt': 1, '--autocompact': 1,
    '-n': 1, '--name': 1, '--debug-file': 1,
    '--add-dir': '*', '--mcp-config': '*', '--plugin-dir': '*', '--allowedTools': '*',
    '--allowed-tools': '*', '--disallowedTools': '*', '--disallowed-tools': '*', '--tools': '*', '--betas': '*',
    '--dangerously-skip-permissions': 0, '--allow-dangerously-skip-permissions': 0,
    '--verbose': 0, '--ide': 0, '--chrome': 0, '--no-chrome': 0, '--strict-mcp-config': 0,
    '--bare': 0, '--brief': 0, '--disable-slash-commands': 0, '--safe-mode': 0, '--restricted': 0,
  },
  // Conversation choice, one-off launch or already done (worktree created).
  drop: {
    '-c': 0, '--continue': 0, '-r': '?', '--resume': '?', '--session-id': 1, '--fork-session': 0,
    '-w': '?', '--worktree': '?', '--tmux': 0, '--from-pr': '?', '--teleport': '?',
    '-p': 0, '--print': 0, '--bg': 0, '--background': 0, '--remote-control': '?',
    '--cloud': '?', '--file': '*', '-d': '?', '--debug': '?',
  },
}

const CODEX: FlagSpec = {
  keep: {
    '-c': 1, '--config': 1, '--enable': 1, '--disable': 1, '-m': 1, '--model': 1,
    '--local-provider': 1, '-p': 1, '--profile': 1, '-s': 1, '--sandbox': 1,
    '-C': 1, '--cd': 1, '--add-dir': 1, '-a': 1, '--ask-for-approval': 1,
    '--remote': 1, '--remote-auth-token-env': 1,
    '--oss': 0, '--search': 0, '--no-alt-screen': 0, '--no-daemon': 0, '--full-auto': 0,
    '--dangerously-bypass-approvals-and-sandbox': 0, '--yolo': 0, '--approve-for-me': 0,
    '--strict-config': 0, '--dangerously-bypass-hook-trust': 0,
  },
  drop: { '--last': 0, '--all': 0, '--include-non-interactive': 0, '-i': '*', '--image': '*', '--worktree': 0 },
}

const SILENT = new Set(['-c', '--continue', '-r', '--resume', '--session-id', '--fork-session', '--last', '--all'])

const SPECS: Record<string, FlagSpec> = { claude: CLAUDE, codex: CODEX }

// Agents that wherdr can relaunch on their conversation.
export const RESTARTABLE = new Set(Object.keys(SPECS))

const base = (s: string) => s.replace(/^.*\//, '').replace(/\.(c?js|mjs)$/, '')

// Options of the original command line: those to carry over and those
// left aside. Positional arguments (initial message, session
// id, Codex `resume` subcommand) are never carried over.
// Each option is a group [option, values…].
export function launchOptions(kind: string, argv: string[]): { kept: string[][], dropped: string[][] } {
  const spec = SPECS[kind]
  const kept: string[][] = []
  const dropped: string[][] = []
  if (!spec) return { kept, dropped }
  // The executable may be launched by node (`node …/codex.js`): we start from it.
  let i = argv.findIndex(a => base(a) === kind)
  i = i < 0 ? 1 : i + 1
  for (; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--') break
    if (!a.startsWith('-') || a === '-') continue
    const eq = a.indexOf('=')
    const flag = eq > 0 ? a.slice(0, eq) : a
    const keep = flag in spec.keep
    const arity: Arity | undefined = keep ? spec.keep[flag] : spec.drop[flag]
    const out = [a]
    // Conversation choice: replaced by the resume, nothing to report.
    if (keep) kept.push(out)
    else if (!SILENT.has(flag)) dropped.push(out)
    // Unknown option: we do not know whether it takes a value, we drop it
    // with the value that may follow it.
    if (arity === undefined) {
      if (eq < 0 && argv[i + 1] !== undefined && !argv[i + 1]!.startsWith('-')) out.push(argv[++i]!)
      continue
    }
    if (eq > 0 || arity === 0) continue
    if (arity === 1) {
      if (argv[i + 1] !== undefined) out.push(argv[++i]!)
      continue
    }
    // Optional or multiple value: anything that does not look like an option.
    while (argv[i + 1] !== undefined && !argv[i + 1]!.startsWith('-')) {
      out.push(argv[++i]!)
      if (arity === '?') break
    }
  }
  return { kept, dropped }
}

// Relaunch command. `session`: current conversation whose transcript
// exists; `hadSession`: the agent had a session id (without a transcript:
// empty conversation, nothing to resume).
// `current`: settings in effect read from Claude's screen (effort, permission
// mode), which win over the command line: `--resume` does not restore
// them, and they may have changed during the session (/effort, Shift+Tab).
export interface CurrentSettings { effort?: string | null, permissionMode?: string | null }
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])
export function planRestart(o: { kind: string, argv: string[] | null, session: string | null, hadSession: boolean, current?: CurrentSettings }): RestartPlan {
  const opts = o.argv ? launchOptions(o.kind, o.argv) : { kept: [], dropped: [] }
  const mode: RestartMode = o.session ? 'resume' : o.hadSession ? 'fresh' : 'continue'
  let groups = opts.kept
  if (o.kind === 'claude') {
    const cur = o.current || {}
    const without = (...flags: string[]) => { groups = groups.filter(g => !flags.includes(g[0]!.split('=')[0]!)) }
    // `--resume` restores the conversation's last model (possibly
    // changed during the session): the original option would override it.
    if (mode === 'resume') without('--model')
    const effort = String(cur.effort || '').toLowerCase()
    if (EFFORTS.has(effort)) {
      without('--effort')
      groups.push(['--effort', effort])
    }
    if (cur.permissionMode) {
      without('--permission-mode')
      if (cur.permissionMode !== 'default') groups.push(['--permission-mode', cur.permissionMode])
    }
  }
  const kept = groups.flat()
  const dropped = opts.dropped.flat()
  let args: string[]
  if (o.kind === 'codex') {
    args = mode === 'fresh' ? kept : ['resume', ...kept, mode === 'resume' ? o.session! : '--last']
  } else {
    args = mode === 'resume' ? [...kept, '--resume', o.session!] : mode === 'continue' ? [...kept, '--continue'] : kept
  }
  return { args, mode, kept, dropped, unknownArgs: !o.argv }
}

// Permission mode shown below Claude's input field
// ("⏸ plan mode on (shift+tab to cycle)"). Field visible without a mention:
// default mode. Field not found (menu open…): null, unknown.
const FOOTER_MODES: [RegExp, string][] = [
  [/\bplan mode on\b/i, 'plan'], [/\baccept edits on\b/i, 'acceptEdits'],
  [/\bauto mode on\b/i, 'auto'], [/\bbypass permissions on\b/i, 'bypassPermissions'],
  [/\bdon'?t ask (?:mode )?on\b/i, 'dontAsk'],
]
export function claudeFooterMode(text: string | null | undefined): string | null {
  const lines = String(text || '').split('\n')
  let rule = -1
  for (let i = lines.length - 1; i >= 0 && rule < 0; i--) if (/^\s*─{20,}\s*$/.test(lines[i]!)) rule = i
  // The bottom border of the field, just below its "❯" line (not a dialog).
  if (rule < 1 || !lines.slice(Math.max(0, rule - 6), rule).some(l => /^\s*❯/.test(l))) return null
  for (const l of lines.slice(rule + 1)) {
    for (const [re, mode] of FOOTER_MODES) if (re.test(l)) return mode
  }
  return 'default'
}

// Agent busy working or waiting for an answer: restarting it interrupts
// what it is doing, so we ask for confirmation.
export function restartNeedsWarning(status: string | null | undefined): boolean {
  return status === 'working' || status === 'blocked'
}

export type RestartPreview = Pick<RestartPlan, 'mode' | 'kept' | 'dropped' | 'unknownArgs'>
// What the confirmation must say. Nothing to report (agent idle, options
// found, conversation resumed): direct restart, no modal.
export function restartNotice(status: string | null | undefined, pv: RestartPreview) {
  const busy = restartNeedsWarning(status)
  const defaults = pv.unknownArgs
  const fresh = pv.mode === 'fresh'
  return { busy, defaults, dropped: pv.dropped, fresh, confirm: busy || defaults || fresh || pv.dropped.length > 0 }
}
