// Commandes « / » proposées par le champ de saisie, comme le menu du terminal :
// les commandes intégrées de l'agent (slashcatalog.ts) + celles lues sur la
// machine du pane (disque local, ou SSH) :
//  - Claude Code : skills (~/.claude/skills/**/SKILL.md, y compris ceux
//    synchronisés depuis le compte), commandes (~/.claude/commands/**.md), et
//    les mêmes dans <dossier du projet>/.claude/.
//  - Codex : invites personnelles ~/.codex/prompts/*.md -> /prompts:<nom>.
import path from 'node:path'
import type { SlashCommand } from '../../shared/types'
import type { MachineFs } from './fsx'
import { CLAUDE_BUILTIN, CODEX_BUILTIN } from './slashcatalog'

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
async function claudeSkills(fs: MachineFs, root: string, out: SlashCommand[]) {
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
    out.push({ name: fm.name || path.basename(dirs[i]!), desc: fm.description || '', hint: fm['argument-hint'] || undefined, source: 'skill' })
  }
}

// commands/**.md : les sous-dossiers donnent des noms « dossier:commande ».
async function claudeCommands(fs: MachineFs, root: string, out: SlashCommand[], prefix = '', depth = 0) {
  for (const n of await ls(fs, root)) {
    const f = path.join(root, n)
    if (n.endsWith('.md')) {
      const text = await read(fs, f)
      if (text === null) continue
      const fm = frontmatter(text)
      out.push({ name: prefix + n.slice(0, -3), desc: fm.description || firstLine(text), hint: fm['argument-hint'] || undefined, source: 'command' })
    } else if (depth < 2 && !n.includes('.')) {
      await claudeCommands(fs, f, out, `${prefix}${n}:`, depth + 1)
    }
  }
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
  return mergeCommands(kind === 'claude' ? CLAUDE_BUILTIN : kind === 'codex' ? CODEX_BUILTIN : [], [])
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
      await claudeSkills(fs, path.join(cwd, '.claude/skills'), extra)
      await claudeCommands(fs, path.join(cwd, '.claude/commands'), extra)
    }
    await claudeSkills(fs, path.join(home, '.claude/skills'), extra)
    await claudeCommands(fs, path.join(home, '.claude/commands'), extra)
  } else if (kind === 'codex') {
    builtin = CODEX_BUILTIN
    for (const n of await ls(fs, path.join(home, '.codex/prompts'))) {
      if (!n.endsWith('.md')) continue
      const text = await read(fs, path.join(home, '.codex/prompts', n))
      if (text === null) continue
      const fm = frontmatter(text)
      extra.push({ name: `prompts:${n.slice(0, -3)}`, desc: fm.description || firstLine(text), hint: fm['argument-hint'] || undefined, source: 'command' })
    }
  }
  const list = mergeCommands(builtin, extra)
  cache.set(id, { at: Date.now(), list })
  return list
}
