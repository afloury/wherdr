// Redémarrer un agent dans son pane (mise à jour de Claude Code…) en gardant
// sa conversation. Logique pure, partagée par le serveur et les tests :
// - quelles options de lancement d'origine reprendre (argv du processus lu par
//   `pane.process_info`) ;
// - quelle commande de relance (`claude --resume <id>`, `codex resume <id>`…).
//
// Vérifié avec Claude Code 2.1 : `claude --resume <id>` restaure le modèle,
// mais ni l'effort ni le mode de permission (plan -> mode par défaut) : les
// options d'origine sont donc rejouées. Une session sans aucun message n'a pas
// de transcription et `--resume` échoue (« No conversation found ») : l'agent
// repart alors neuf, avec ses options.

export type RestartMode = 'resume' | 'continue' | 'fresh'
export type RestartPhase = 'stopping' | 'starting' | 'failed'

export interface RestartPlan {
  // Arguments passés à `agent.start` (après l'exécutable).
  args: string[]
  mode: RestartMode
  // Options d'origine reprises telles quelles (affichées dans la confirmation).
  kept: string[]
  // Options d'origine non reprises (inconnues ou propres au premier lancement).
  dropped: string[]
  // Ligne de commande d'origine introuvable : relance avec les réglages par défaut.
  unknownArgs: boolean
}

// Nombre de valeurs d'une option : 1 = une valeur, '*' = une ou plusieurs
// (jusqu'à l'option suivante), '?' = valeur facultative.
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
  // Choix de conversation, lancement unique ou déjà fait (worktree créé).
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

// Agents que wherdr sait relancer sur leur conversation.
export const RESTARTABLE = new Set(Object.keys(SPECS))

const base = (s: string) => s.replace(/^.*\//, '').replace(/\.(c?js|mjs)$/, '')

// Options de la ligne de commande d'origine : celles à reprendre et celles
// laissées de côté. Les arguments positionnels (message initial, id de
// session, sous-commande `resume` de Codex) ne sont jamais repris.
// Chaque option est un groupe [option, valeurs…].
export function launchOptions(kind: string, argv: string[]): { kept: string[][], dropped: string[][] } {
  const spec = SPECS[kind]
  const kept: string[][] = []
  const dropped: string[][] = []
  if (!spec) return { kept, dropped }
  // L'exécutable peut être lancé par node (`node …/codex.js`) : on part de lui.
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
    // Choix de conversation : remplacé par la reprise, rien à signaler.
    if (keep) kept.push(out)
    else if (!SILENT.has(flag)) dropped.push(out)
    // Option inconnue : on ne sait pas si elle prend une valeur, on l'écarte
    // avec la valeur éventuelle qui la suit.
    if (arity === undefined) {
      if (eq < 0 && argv[i + 1] !== undefined && !argv[i + 1]!.startsWith('-')) out.push(argv[++i]!)
      continue
    }
    if (eq > 0 || arity === 0) continue
    if (arity === 1) {
      if (argv[i + 1] !== undefined) out.push(argv[++i]!)
      continue
    }
    // Valeur facultative ou multiple : tout ce qui ne ressemble pas à une option.
    while (argv[i + 1] !== undefined && !argv[i + 1]!.startsWith('-')) {
      out.push(argv[++i]!)
      if (arity === '?') break
    }
  }
  return { kept, dropped }
}

// Commande de relance. `session` : conversation en cours dont la transcription
// existe ; `hadSession` : l'agent avait un id de session (sans transcription :
// conversation vide, rien à reprendre).
// `current` : réglages en service lus à l'écran de Claude (effort, mode de
// permission), qui l'emportent sur la ligne de commande : `--resume` ne les
// restaure pas, et ils ont pu changer en cours de session (/effort, Maj+Tab).
export interface CurrentSettings { effort?: string | null, permissionMode?: string | null }
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])
export function planRestart(o: { kind: string, argv: string[] | null, session: string | null, hadSession: boolean, current?: CurrentSettings }): RestartPlan {
  const opts = o.argv ? launchOptions(o.kind, o.argv) : { kept: [], dropped: [] }
  const mode: RestartMode = o.session ? 'resume' : o.hadSession ? 'fresh' : 'continue'
  let groups = opts.kept
  if (o.kind === 'claude') {
    const cur = o.current || {}
    const without = (...flags: string[]) => { groups = groups.filter(g => !flags.includes(g[0]!.split('=')[0]!)) }
    // `--resume` restaure le dernier modèle de la conversation (éventuellement
    // changé en cours de session) : l'option d'origine l'écraserait.
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

// Mode de permission affiché sous le champ de saisie de Claude
// (« ⏸ plan mode on (shift+tab to cycle) »). Champ visible sans mention :
// mode par défaut. Champ introuvable (menu ouvert…) : null, inconnu.
const FOOTER_MODES: [RegExp, string][] = [
  [/\bplan mode on\b/i, 'plan'], [/\baccept edits on\b/i, 'acceptEdits'],
  [/\bauto mode on\b/i, 'auto'], [/\bbypass permissions on\b/i, 'bypassPermissions'],
  [/\bdon'?t ask (?:mode )?on\b/i, 'dontAsk'],
]
export function claudeFooterMode(text: string | null | undefined): string | null {
  const lines = String(text || '').split('\n')
  let rule = -1
  for (let i = lines.length - 1; i >= 0 && rule < 0; i--) if (/^\s*─{20,}\s*$/.test(lines[i]!)) rule = i
  // Le cadre du bas du champ, juste sous sa ligne « ❯ » (pas un dialogue).
  if (rule < 1 || !lines.slice(Math.max(0, rule - 6), rule).some(l => /^\s*❯/.test(l))) return null
  for (const l of lines.slice(rule + 1)) {
    for (const [re, mode] of FOOTER_MODES) if (re.test(l)) return mode
  }
  return 'default'
}

// Agent en plein travail ou qui attend une réponse : le redémarrer interrompt
// ce qu'il fait, on demande confirmation.
export function restartNeedsWarning(status: string | null | undefined): boolean {
  return status === 'working' || status === 'blocked'
}

export type RestartPreview = Pick<RestartPlan, 'mode' | 'kept' | 'dropped' | 'unknownArgs'>
// Ce que la confirmation doit dire. Rien à signaler (agent au repos, options
// retrouvées, conversation reprise) : redémarrage direct, sans modale.
export function restartNotice(status: string | null | undefined, pv: RestartPreview) {
  const busy = restartNeedsWarning(status)
  const defaults = pv.unknownArgs
  const fresh = pv.mode === 'fresh'
  return { busy, defaults, dropped: pv.dropped, fresh, confirm: busy || defaults || fresh || pv.dropped.length > 0 }
}
