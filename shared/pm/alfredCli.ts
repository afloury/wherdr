// `wherdr alfred …`: Alfred's own commands, to read and change wherdr's
// projects, coordinators and settings. Pure: the parser, the command table
// (also written in Alfred's AGENTS.md) and the "show, then do" text; the
// server (server/utils/alfredCli.ts) reads and writes.
import { isSyncedSetting, SETTING_MAX, SYNCED_SETTINGS, type SyncedSetting } from '../settings'

export type AlfredCommand =
  | { name: 'help' | 'projects' | 'templates' | 'machines' | 'coordinators' | 'settings' }
  | { name: 'project', key: string }
  | { name: 'coordinator open', key: string }
  // Changes: a dry run unless apply.
  | { name: 'project add', apply: boolean, input: { key: string, machine: string, path: string, name?: string, template?: string } }
  | { name: 'project template', apply: boolean, key: string, template: string } // '' clears it
  | { name: 'coordinator start', apply: boolean, key: string, program?: 'claude' | 'codex', model?: string }
  | { name: 'setting set', apply: boolean, key: SyncedSetting, value: string }

// One table for the parser's usage errors, `help` and AGENTS.md.
export const ALFRED_COMMANDS: { usage: string, does: string }[] = [
  { usage: 'projects', does: 'whether projects are on, and each project (key, name, machine, folder, template)' },
  { usage: 'project <KEY>', does: 'one project, its coordinator and its tasks by state' },
  { usage: 'templates', does: 'the saved templates' },
  { usage: 'machines', does: 'the machines herdr-core knows (key, label, status); the key "" is this machine' },
  { usage: 'coordinators', does: 'each coordinator: its agent and whether it runs' },
  { usage: 'coordinator open <KEY>', does: 'the link that opens a running project coordinator, to give the user' },
  { usage: 'settings', does: 'the synced settings and their values' },
  { usage: 'project add <KEY> --machine <key> --path <folder> [--name <name>] [--template <id>]', does: 'add a project: a git folder on a machine' },
  { usage: 'project template <KEY> <id|none>', does: 'give the project a template, or none' },
  { usage: 'coordinator start <KEY> [--program claude|codex --model <model>]', does: 'start the project\'s coordinator (a new conversation replaces a running one)' },
  { usage: 'setting set <key> <value>', does: 'change a synced setting' },
]

const KEY_RE = /^[A-Za-z][A-Za-z0-9]{1,9}$/
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:[\]/-]{0,63}$/
const FLAGS: Record<string, string[]> = {
  'project add': ['machine', 'path', 'name', 'template'],
  'coordinator start': ['program', 'model'],
}

export const CHANGES = ['project add', 'project template', 'coordinator start', 'setting set']
const usage = (verb: string) => ({ error: `usage: wherdr alfred ${ALFRED_COMMANDS.find(c => c.usage.startsWith(verb))!.usage}${CHANGES.includes(verb) ? ' [--apply]' : ''}` })

// argv after `wherdr alfred` → a command, or the reason it is not one.
// --apply (no value) makes a change; without it, the change is only shown.
export function parseAlfredCommand(argv: unknown): AlfredCommand | { error: string } {
  if (!Array.isArray(argv) || !argv.every(a => typeof a === 'string')) return { error: 'argv must be a list of words' }
  const words: string[] = [], flags: Record<string, string> = {}
  let apply = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string
    if (a === '--apply') { apply = true; continue }
    if (!a.startsWith('--')) { words.push(a); continue }
    const v = argv[i + 1] as string | undefined
    if (v === undefined || v.startsWith('--')) return { error: `${a} needs a value` }
    flags[a.slice(2)] = v
    i++
  }
  const [w0 = '', w1 = '', w2, w3, ...rest] = words
  const verb = `${w0} ${w1}`
  const extra = Object.keys(flags).find(f => !(FLAGS[verb] ?? []).includes(f))
  if (extra) return { error: `unknown option --${extra}` }
  if (apply && !CHANGES.includes(verb)) return { error: '--apply is for a change only' }
  const key = (k: string | undefined) => (k && KEY_RE.test(k) ? k.toUpperCase() : '')

  if (['help', 'projects', 'templates', 'machines', 'coordinators', 'settings'].includes(w0) && !w1)
    return { name: w0 as 'help' }
  if (w0 === 'project' && words.length === 2 && !['add', 'template'].includes(w1)) return key(w1) ? { name: 'project', key: key(w1) } : usage('project <KEY>')
  if (verb === 'coordinator open') return key(w2) && !w3 ? { name: verb, key: key(w2) } : usage(verb)
  if (verb === 'project add') {
    const { machine, path, name, template } = flags
    if (!key(w2) || w3 || machine === undefined || !path) return usage(verb)
    if (template !== undefined && !ID_RE.test(template)) return { error: '--template is a template id (see wherdr alfred templates)' }
    return { name: verb, apply, input: { key: key(w2), machine, path, ...(name ? { name } : {}), ...(template ? { template } : {}) } }
  }
  if (verb === 'project template') {
    if (!key(w2) || !w3 || rest.length) return usage(verb)
    if (w3 !== 'none' && !ID_RE.test(w3)) return { error: 'The template is a template id, or none' }
    return { name: verb, apply, key: key(w2), template: w3 === 'none' ? '' : w3 }
  }
  if (verb === 'coordinator start') {
    const { program, model } = flags
    if (!key(w2) || w3) return usage(verb)
    if ((program === undefined) !== (model === undefined)) return { error: '--program and --model go together' }
    if (program !== undefined && program !== 'claude' && program !== 'codex') return { error: '--program is claude or codex' }
    if (model !== undefined && !MODEL_RE.test(model)) return { error: 'invalid --model' }
    return { name: verb, apply, key: key(w2), ...(program ? { program: program as 'claude' | 'codex', model } : {}) }
  }
  if (verb === 'setting set') {
    if (!w2 || w3 === undefined || rest.length) return usage(verb)
    if (!isSyncedSetting(w2)) return { error: `Unknown setting ${w2}: one of ${SYNCED_SETTINGS.join(', ')}` }
    if (w3.length > SETTING_MAX) return { error: `A value is ${SETTING_MAX} characters at most` }
    return { name: verb, apply, key: w2, value: w3 }
  }
  return { error: `unknown command: ${words.join(' ') || '(none)'} (see wherdr alfred help)` }
}

// What a change does, shown before it is made: the lines, the command that
// makes it, and where it reaches (a remote machine is named).
export interface AlfredPlan { change: string[], remote?: string }
export function dryRun(argv: string[], plan: AlfredPlan) {
  return {
    dryRun: true, change: plan.change,
    ...(plan.remote ? { remote: `This reaches machine ${plan.remote}: make it only if the user asked for it` } : {}),
    next: `Show this to the user; only after their yes, run: wherdr alfred ${[...argv.filter(a => a !== '--apply'), '--apply'].map(quoteWord).join(' ')}`,
  }
}
const quoteWord = (w: string) => (/^[\w@%+=:,./-]+$/.test(w) ? w : `'${w.replace(/'/g, `'\\''`)}'`)

export const alfredCommandList = () => ALFRED_COMMANDS.map(c => `- \`wherdr alfred ${c.usage}${CHANGES.some(v => c.usage.startsWith(v)) ? ' [--apply]' : ''}\`: ${c.does}`)
