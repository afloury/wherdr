// Commandes « / » proposées par le champ de saisie, comme le menu du terminal :
// les commandes intégrées de l'agent (slashcatalog.ts) + celles lues sur la
// machine du pane (disque local, ou SSH) :
//  - Claude Code : skills (~/.claude/skills/**/SKILL.md, y compris ceux
//    synchronisés depuis le compte), commandes (~/.claude/commands/**.md), et
//    les mêmes dans <dossier du projet>/.claude/.
//  - Codex : invites personnelles ~/.codex/prompts/*.md -> /prompts:<nom>.
//  - omp : commandes (~/.omp/agent/commands, et celles de Claude Code, Codex et
//    ~/.agents qu'il découvre aussi), skills -> /skill:<nom> (mêmes dossiers,
//    plus `skills.customDirectories` de ~/.omp/agent/config.yml), et les mêmes
//    dans le dossier du projet.
import path from 'node:path'
import type { SlashCommand } from '../../shared/types'
import type { MachineFs } from './fsx'
import { CLAUDE_BUILTIN, CODEX_BUILTIN, OMP_BUILTIN } from './slashcatalog'

const TTL = 5 * 60 * 1000
const cache = new Map<string, { at: number, list: SlashCommand[] }>()

// Frontmatter YAML minimal (clés simples sur une ligne).
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

// Première phrase utile d'un fichier de commande sans description.
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

// skills/<nom>/SKILL.md, et un niveau de plus (skills/synced/<compte>/<nom>/).
async function readSkills(fs: MachineFs, root: string, out: SlashCommand[], prefix = '') {
  const dirs: string[] = []
  for (const a of await ls(fs, root)) {
    dirs.push(path.join(root, a))
    for (const b of await ls(fs, path.join(root, a))) {
      if (b === 'SKILL.md') continue
      dirs.push(path.join(root, a, b))
      for (const c of await ls(fs, path.join(root, a, b))) if (c !== 'SKILL.md') dirs.push(path.join(root, a, b, c))
    }
  }
  const files = dirs.map(d => path.join(d, 'SKILL.md'))
  const st = files.length ? await fs.statMany(files) : []
  for (let i = 0; i < files.length; i++) {
    if (!st[i] || !st[i]!.isFile) continue
    const text = await read(fs, files[i]!)
    if (text === null) continue
    const fm = frontmatter(text)
    if (fm['user-invocable'] === 'false') continue
    out.push({ name: prefix + (fm.name || path.basename(dirs[i]!)), desc: fm.description || '', hint: fm['argument-hint'] || undefined, source: 'skill' })
  }
}

// commands/**.md : les sous-dossiers donnent des noms « dossier:commande ».
async function readCommands(fs: MachineFs, root: string, out: SlashCommand[], prefix = '', depth = 0) {
  for (const n of await ls(fs, root)) {
    const f = path.join(root, n)
    if (n.endsWith('.md')) {
      const text = await read(fs, f)
      if (text === null) continue
      const fm = frontmatter(text)
      out.push({ name: prefix + n.slice(0, -3), desc: fm.description || firstLine(text), hint: fm['argument-hint'] || undefined, source: 'command' })
    } else if (depth < 2 && !n.includes('.')) {
      await readCommands(fs, f, out, `${prefix}${n}:`, depth + 1)
    }
  }
}

// `skills.customDirectories` de la config d'omp (YAML : liste sous la clé).
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
  // Les commandes personnelles d'abord : elles masquent une intégrée du même nom.
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

export async function slashCommands(opts: { key: string, fs: MachineFs, home: string, kind: string, cwd: string | null }) {
  const { fs, home, kind, cwd } = opts
  const id = `${opts.key}|${kind}|${cwd || ''}`
  const hit = cache.get(id)
  if (hit && Date.now() - hit.at < TTL) return hit.list
  const extra: SlashCommand[] = []
  let builtin: [string, string, string?][] = []
  if (kind === 'claude') {
    builtin = CLAUDE_BUILTIN
    if (cwd && cwd !== home) {
      await readSkills(fs, path.join(cwd, '.claude/skills'), extra)
      await readCommands(fs, path.join(cwd, '.claude/commands'), extra)
    }
    await readSkills(fs, path.join(home, '.claude/skills'), extra)
    await readCommands(fs, path.join(home, '.claude/commands'), extra)
  } else if (kind === 'codex') {
    builtin = CODEX_BUILTIN
    for (const n of await ls(fs, path.join(home, '.codex/prompts'))) {
      if (!n.endsWith('.md')) continue
      const text = await read(fs, path.join(home, '.codex/prompts', n))
      if (text === null) continue
      const fm = frontmatter(text)
      extra.push({ name: `prompts:${n.slice(0, -3)}`, desc: fm.description || firstLine(text), hint: fm['argument-hint'] || undefined, source: 'command' })
    }
  } else if (kind === 'omp') {
    builtin = OMP_BUILTIN
    const dirs = ompConfigDirs(home, cwd)
    for (const d of dirs) await readCommands(fs, path.join(d, 'commands'), extra)
    // Commande livrée avec omp (task/commands).
    extra.push({ name: 'init', desc: 'Generate AGENTS.md for current codebase', source: 'command' })
    for (const d of dirs) await readSkills(fs, path.join(d, 'skills'), extra, 'skill:')
    const config = await read(fs, path.join(home, '.omp/agent/config.yml'))
    for (const d of config ? ompSkillDirs(config, home) : []) await readSkills(fs, d, extra, 'skill:')
  }
  const list = mergeCommands(builtin, extra)
  cache.set(id, { at: Date.now(), list })
  return list
}

// Dossiers de config d'omp (projet puis utilisateur, ~/.omp/agent pour omp
// lui-même), du plus prioritaire au moins : le premier nom trouvé l'emporte
// (mergeCommands).
function ompConfigDirs(home: string, cwd: string | null) {
  const bases = [...(cwd && cwd !== home ? [cwd] : []), home]
  return bases.flatMap(b => ['.omp', '.agents', '.agent', '.claude', '.codex'].map(r => path.join(b, b === home && r === '.omp' ? '.omp/agent' : r)))
}

// Texte des commandes-fichiers d'omp (sans frontmatter), celles de l'utilisateur :
// omp l'envoie à la place de « /nom args », la conversation remet la commande
// (cf. parseOmp).
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
