// "/" commands offered by the input field, like the terminal's menu:
// the agent's built-in commands (slashcatalog.ts) + those read on the
// pane's machine (local disk, or SSH):
//  - Claude Code: skills (~/.claude/skills/**/SKILL.md, including those
//    synced from the account), commands (~/.claude/commands/**.md), and
//    the same in <project folder>/.claude/.
//  - Codex: personal prompts ~/.codex/prompts/*.md -> /prompts:<name>.
//  - omp: commands (~/.omp/agent/commands, and those of Claude Code, Codex and
//    ~/.agents that it also discovers), skills -> /skill:<name> (same folders,
//    plus `skills.customDirectories` of ~/.omp/agent/config.yml), and the same
//    in the project folder.
//
// On an SSH machine everything is read by one shell script (one session of
// the shared connection, see machines.ts): one exec per folder and file was
// slow and a single refused session dropped the whole list.
import path from 'node:path'
import type { SlashCommand } from '../../shared/types'
import type { MachineFs, ShellExec } from './fsx'
import { CLAUDE_BUILTIN, CODEX_BUILTIN, OMP_BUILTIN } from './slashcatalog'

const TTL = 5 * 60 * 1000
const cache = new Map<string, { at: number, list: SlashCommand[] }>()

// Minimal YAML frontmatter (simple one-line keys).
export function frontmatter(text: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  const out: Record<string, string> = {}
  if (!m) return out
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line)
    if (kv) out[kv[1]!.toLowerCase()] = kv[2]!.trim().replace(/^(["'])(.*)\1$/, '$2')
  }
  return out
}

// First useful sentence of a command file without a description.
function firstLine(text: string) {
  const body = text.replace(/^---[\s\S]*?\n---\r?\n?/, '')
  const l = body.split('\n').map(s => s.replace(/^#+\s*/, '').trim()).find(Boolean)
  return l ? l.slice(0, 200) : ''
}

async function ls(fs: MachineFs, d: string) {
  try { return await fs.readdir(d) }
  catch { return [] }
}
async function read(fs: MachineFs, f: string) {
  try { return await fs.readFile(f) }
  catch { return null }
}

// Where commands come from: `skills` = <dir>/<name>/SKILL.md up to two more
// levels (skills/synced/<account>/<name>/); `commands` = <dir>/**.md, `depth`
// subfolder levels giving "folder:command" names; `file` = one file.
export interface SlashRoot { dir: string, kind: 'skills' | 'commands' | 'file', prefix?: string, depth?: number }
// A file found under a root: its path relative to it ('' for a `file`) and its start.
export interface SlashFile { root: number, rel: string, text: string }

const HEAD = 16384

async function collectLocal(fs: MachineFs, roots: SlashRoot[]): Promise<SlashFile[]> {
  const out: SlashFile[] = []
  for (let i = 0; i < roots.length; i++) {
    const r = roots[i]!
    if (r.kind === 'file') {
      const text = await read(fs, r.dir)
      if (text !== null) out.push({ root: i, rel: '', text })
    } else if (r.kind === 'skills') {
      const dirs: string[] = []
      for (const a of await ls(fs, r.dir)) {
        dirs.push(a)
        for (const b of await ls(fs, path.join(r.dir, a))) {
          if (b === 'SKILL.md') continue
          dirs.push(path.join(a, b))
          for (const c of await ls(fs, path.join(r.dir, a, b))) if (c !== 'SKILL.md') dirs.push(path.join(a, b, c))
        }
      }
      const rels = dirs.map(d => path.join(d, 'SKILL.md'))
      const st = rels.length ? await fs.statMany(rels.map(f => path.join(r.dir, f))).catch(() => []) : []
      for (let j = 0; j < rels.length; j++) {
        if (!st[j] || !st[j]!.isFile) continue
        const text = await read(fs, path.join(r.dir, rels[j]!))
        if (text !== null) out.push({ root: i, rel: rels[j]!, text })
      }
    } else {
      const walk = async (rel: string, depth: number) => {
        for (const n of await ls(fs, path.join(r.dir, rel))) {
          const f = rel ? path.join(rel, n) : n
          if (n.endsWith('.md')) {
            const text = await read(fs, path.join(r.dir, f))
            if (text !== null) out.push({ root: i, rel: f, text })
          } else if (depth < (r.depth ?? 2) && !n.includes('.')) await walk(f, depth + 1)
        }
      }
      await walk('', 0)
    }
  }
  return out
}

// Arguments: pairs <kind> <dir>. One record per file found:
// RS <root index> US <relative path> US <first bytes>.
export const SLASH_SCRIPT = `i=0
while [ $# -ge 2 ]; do
  k=$1; d=$2; shift 2
  case $k in
    file) if [ -f "$d" ]; then printf '\\036%s\\037\\037' "$i"; head -c ${HEAD} "$d"; fi ;;
    skills|commands*)
      if [ "$k" = skills ]; then lo=2; hi=4; name=SKILL.md; else lo=1; hi=$((\${k#commands} + 1)); name='*.md'; fi
      if [ -d "$d" ]; then
        find -L "$d" -mindepth $lo -maxdepth $hi -name "$name" -type f 2>/dev/null | sort | while IFS= read -r f; do
          printf '\\036%s\\037%s\\037' "$i" "\${f#"$d"/}"; head -c ${HEAD} "$f"
        done
      fi ;;
  esac
  i=$((i + 1))
done
exit 0`

export function parseSlashFiles(out: string): SlashFile[] {
  const files: SlashFile[] = []
  for (const rec of out.split('\x1E')) {
    const a = rec.indexOf('\x1F')
    const b = a < 0 ? -1 : rec.indexOf('\x1F', a + 1)
    if (b < 0) continue
    files.push({ root: Number(rec.slice(0, a)), rel: rec.slice(a + 1, b), text: rec.slice(b + 1) })
  }
  return files
}

// One script run; a failed run (a session the connection refused…) is
// retried once, then thrown: never mistaken for "no commands".
async function collectRemote(exec: ShellExec, roots: SlashRoot[]): Promise<SlashFile[]> {
  const args = roots.flatMap(r => [r.kind === 'commands' ? `commands${r.depth ?? 2}` : r.kind, path.posix.normalize(r.dir).replace(/(.)\/+$/, '$1')])
  let last = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) {
      const { promise, resolve } = Promise.withResolvers<void>()
      setTimeout(resolve, 400)
      await promise
    }
    const r = await exec(SLASH_SCRIPT, args, { timeoutMs: 20000 })
    if (r.code === 0) return parseSlashFiles(r.stdout.toString('utf8'))
    last = (r.stderr || `code ${r.code}`).trim().split('\n').pop() || 'failed'
  }
  throw new Error(last)
}

// Commands of the files found, in root then path order.
export function commandsOf(roots: SlashRoot[], files: SlashFile[]): SlashCommand[] {
  const out: SlashCommand[] = []
  const sorted = [...files].sort((a, b) => a.root - b.root || (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  for (const f of sorted) {
    const r = roots[f.root]
    if (!r || r.kind === 'file') continue
    const parts = f.rel.split('/')
    const fm = frontmatter(f.text)
    const hint = fm['argument-hint'] || undefined
    if (r.kind === 'skills') {
      if (parts.length < 2 || parts.length > 4 || parts.at(-1) !== 'SKILL.md' || fm['user-invocable'] === 'false') continue
      out.push({ name: (r.prefix || '') + (fm.name || parts.at(-2)!), desc: fm.description || '', hint, source: 'skill' })
    } else {
      const dirs = parts.slice(0, -1)
      if (!parts.at(-1)!.endsWith('.md') || dirs.length > (r.depth ?? 2) || dirs.some(d => d.includes('.'))) continue
      out.push({ name: (r.prefix || '') + [...dirs, parts.at(-1)!.slice(0, -3)].join(':'), desc: fm.description || firstLine(f.text), hint, source: 'command' })
    }
  }
  return out
}

// `skills.customDirectories` of omp's config (YAML: list under the key).
export function ompSkillDirs(config: string, home: string): string[] {
  const out: string[] = []
  let inSkills = false
  let inList = false
  for (const line of config.split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue
    const indent = line.length - line.trimStart().length
    if (indent === 0) {
      inSkills = /^skills:\s*$/.test(line)
      inList = false
    } else if (inSkills && /^\s+customDirectories:\s*$/.test(line)) {
      inList = true
    } else if (inList) {
      const item = /^\s+-\s+(.+?)\s*$/.exec(line)
      if (!item) { inList = false; continue }
      const dir = item[1]!.replace(/^(["'])(.*)\1$/, '$2')
      out.push(dir === '~' || dir.startsWith('~/') ? path.join(home, dir.slice(1)) : path.resolve(home, dir))
    }
  }
  return out
}

export function mergeCommands(builtin: [string, string, string?][], extra: SlashCommand[]): SlashCommand[] {
  const out: SlashCommand[] = []
  const seen = new Set<string>()
  // Personal commands first: they hide a built-in one with the same name.
  for (const c of extra) {
    if (!c.name || seen.has(c.name)) continue
    seen.add(c.name)
    out.push(c)
  }
  for (const [name, desc, hint] of builtin) {
    if (seen.has(name)) continue
    seen.add(name)
    out.push({ name, desc, hint, source: 'builtin' })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export function builtinCommands(kind: string) {
  return mergeCommands(kind === 'claude' ? CLAUDE_BUILTIN : kind === 'codex' ? CODEX_BUILTIN : kind === 'omp' ? OMP_BUILTIN : [], [])
}

export async function slashCommands(opts: { key: string, fs: MachineFs, exec?: ShellExec | null, home: string, kind: string, cwd: string | null }) {
  const { fs, exec, home, kind, cwd } = opts
  const id = `${opts.key}|${kind}|${cwd || ''}`
  const hit = cache.get(id)
  if (hit && Date.now() - hit.at < TTL) return hit.list
  const collect = (roots: SlashRoot[]) => (exec ? collectRemote(exec, roots) : collectLocal(fs, roots))
  const project = cwd && cwd !== home ? cwd : null
  let roots: SlashRoot[] = []
  let builtin: [string, string, string?][] = []
  const extra: SlashCommand[] = []
  if (kind === 'claude') {
    builtin = CLAUDE_BUILTIN
    for (const b of project ? [project, home] : [home]) {
      roots.push({ dir: path.join(b, '.claude/skills'), kind: 'skills' }, { dir: path.join(b, '.claude/commands'), kind: 'commands' })
    }
  } else if (kind === 'codex') {
    builtin = CODEX_BUILTIN
    roots = [{ dir: path.join(home, '.codex/prompts'), kind: 'commands', depth: 0, prefix: 'prompts:' }]
  } else if (kind === 'omp') {
    builtin = OMP_BUILTIN
    const dirs = ompConfigDirs(home, cwd)
    const config: SlashRoot = { dir: path.join(home, '.omp/agent/config.yml'), kind: 'file' }
    roots = [...dirs.map(d => ({ dir: path.join(d, 'commands'), kind: 'commands' as const })), config, ...dirs.map(d => ({ dir: path.join(d, 'skills'), kind: 'skills' as const, prefix: 'skill:' }))]
    const files = await collect(roots)
    const cfg = files.find(f => roots[f.root] === config)
    const more = cfg ? ompSkillDirs(cfg.text, home).map(d => ({ dir: d, kind: 'skills' as const, prefix: 'skill:' })) : []
    const all = [...roots, ...more]
    const found = more.length ? [...files, ...(await collect(more)).map(f => ({ ...f, root: f.root + roots.length }))] : files
    const cmds = commandsOf(all, found)
    // Command shipped with omp (task/commands), after the user's ones, before the skills.
    const firstSkill = cmds.findIndex(c => c.source === 'skill')
    cmds.splice(firstSkill < 0 ? cmds.length : firstSkill, 0, { name: 'init', desc: 'Generate AGENTS.md for current codebase', source: 'command' })
    extra.push(...cmds)
    roots = []
  }
  if (roots.length) extra.push(...commandsOf(roots, await collect(roots)))
  const list = mergeCommands(builtin, extra)
  cache.set(id, { at: Date.now(), list })
  return list
}

// omp config folders (project then user, ~/.omp/agent for omp
// itself), from highest to lowest priority: the first name found wins
// (mergeCommands).
function ompConfigDirs(home: string, cwd: string | null) {
  const bases = [...(cwd && cwd !== home ? [cwd] : []), home]
  return bases.flatMap(b => ['.omp', '.agents', '.agent', '.claude', '.codex'].map(r => path.join(b, b === home && r === '.omp' ? '.omp/agent' : r)))
}

// Text of omp's file commands (without frontmatter), the user's ones:
// omp sends it instead of "/name args", the conversation puts the command back
// (see parseOmp).
export interface CommandTemplate { name: string, body: string }
export async function ompCommandTemplates(fs: MachineFs, home: string): Promise<CommandTemplate[]> {
  const out: CommandTemplate[] = []
  for (const d of ompConfigDirs(home, null)) {
    for (const n of await ls(fs, path.join(d, 'commands'))) {
      if (!n.endsWith('.md')) continue
      const text = await read(fs, path.join(d, 'commands', n))
      const body = text && text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim()
      if (body) out.push({ name: n.slice(0, -3), body })
    }
  }
  return out
}
