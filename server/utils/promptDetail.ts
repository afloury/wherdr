// Ce qu'une demande de permission autorise, pour l'afficher au-dessus de la
// question : l'outil, sa description, la commande en entier, ou le fichier.
//
// Deux sources :
//  - la transcription : le dernier appel d'outil encore sans résultat est
//    celui qui attend la permission (commande complète, jamais coupée par la
//    largeur du terminal) ;
//  - l'écran, à défaut : chez Claude Code, le bloc entre le trait ─── et la
//    question ; chez Codex, les lignes entre la question et les options :
//
//   ──────────────────────────────            Would you like to run the following command?
//    Bash command                               Reason: needs network access
//      npm test                                 $ npm install
//      Run the unit tests                     › 1. Yes, proceed (y)
//    Do you want to proceed?
//    ❯ 1. Yes
import type { PromptDetail } from '../../shared/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

const MAX_BODY = 20000
const RULE = /^\s*[─━═]{8,}\s*$/
const DASHED = /^\s*[╌┄┈╍┅┉-]{8,}\s*$/

// Question d'une demande de permission (et pas d'AskUserQuestion, de l'écran
// de confiance du dossier, d'un menu…).
export function isPermissionQuestion(q: string | null | undefined): boolean {
  return /\b(?:proceed|allow|approve|make (?:this|these|the following) edits?|want to (?:make|create|run|edit|write|fetch|use|delete)|like to (?:run|make|apply|allow))\b/i.test(String(q || ''))
}

function body(text: string): Pick<PromptDetail, 'command' | 'truncated'> {
  const s = text.replace(/\s+$/, '')
  return s.length > MAX_BODY ? { command: s.slice(0, MAX_BODY), truncated: true } : { command: s }
}

const shortPath = (p: unknown, home: string) => {
  const s = String(p || '')
  return home.length > 1 && (s === home || s.startsWith(home + '/')) ? '~' + s.slice(home.length) : s
}

// Lignes retirées / ajoutées entre deux textes (comptage par multiensemble :
// un résumé, pas un vrai diff).
export function lineStats(before: string, after: string): { added: number, removed: number } {
  const count = (s: string) => {
    const m = new Map<string, number>()
    if (s) for (const l of s.split('\n')) m.set(l, (m.get(l) || 0) + 1)
    return m
  }
  const a = count(before)
  const b = count(after)
  let removed = 0
  let added = 0
  for (const [l, n] of a) removed += Math.max(0, n - (b.get(l) || 0))
  for (const [l, n] of b) added += Math.max(0, n - (a.get(l) || 0))
  return { added, removed }
}

// Lignes communes au début et à la fin gardées en contexte, le milieu en -/+.
function diffText(before: string, after: string): string {
  const a = before ? before.split('\n') : []
  const b = after ? after.split('\n') : []
  let p = 0
  while (p < a.length && p < b.length && a[p] === b[p]) p++
  let q = 0
  while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++
  return [
    ...a.slice(0, p).map(l => '  ' + l),
    ...a.slice(p, a.length - q).map(l => '- ' + l),
    ...b.slice(p, b.length - q).map(l => '+ ' + l),
    ...a.slice(a.length - q).map(l => '  ' + l),
  ].join('\n')
}

// ------------------------------------------------------------ Claude
export function claudeToolDetail(name: string, input: Json, home = ''): PromptDetail | null {
  const i = input || {}
  switch (name) {
    // Pas des permissions : la question est à l'écran, ou elle vient d'un sous-agent.
    case 'AskUserQuestion': case 'Task': case 'Agent': return null
    case 'Bash': case 'PowerShell':
      return { tool: name, description: i.description || undefined, ...body(String(i.command || '')) }
    case 'Edit': {
      const s = lineStats(String(i.old_string || ''), String(i.new_string || ''))
      return { tool: name, file: shortPath(i.file_path, home), ...s, ...body(diffText(String(i.old_string || ''), String(i.new_string || ''))) }
    }
    case 'MultiEdit': {
      const edits: Json[] = Array.isArray(i.edits) ? i.edits : []
      let added = 0
      let removed = 0
      for (const e of edits) {
        const s = lineStats(String(e.old_string || ''), String(e.new_string || ''))
        added += s.added
        removed += s.removed
      }
      const diff = edits.map(e => diffText(String(e.old_string || ''), String(e.new_string || ''))).join('\n…\n')
      return { tool: name, file: shortPath(i.file_path, home), added, removed, ...body(diff) }
    }
    case 'Write': {
      const content = String(i.content || '')
      return { tool: name, file: shortPath(i.file_path, home), added: content ? content.replace(/\n$/, '').split('\n').length : 0, ...body(content) }
    }
    case 'NotebookEdit':
      return { tool: name, file: shortPath(i.notebook_path, home), ...body(String(i.new_source || '')) }
    case 'Read':
      return { tool: name, file: shortPath(i.file_path, home) }
    case 'WebFetch':
      return { tool: name, description: i.prompt || undefined, ...body(String(i.url || '')) }
    case 'WebSearch':
      return { tool: name, ...body(String(i.query || '')) }
    case 'ExitPlanMode':
      return { tool: name, ...body(String(i.plan || '')) }
    default: {
      // Outil MCP (mcp__serveur__outil) ou autre : son entrée en JSON lisible.
      const m = name.match(/^mcp__(.+?)__(.+)$/)
      const json = Object.keys(i).length ? JSON.stringify(i, null, 2) : ''
      return { tool: m ? `${m[1]} · ${m[2]}` : name, ...(json ? body(json) : {}) }
    }
  }
}

// Premier appel d'outil sans résultat depuis le dernier message de
// l'utilisateur (lignes JSON d'une transcription Claude Code).
export function pendingClaudeTool(lines: string[], home = ''): PromptDetail | null {
  const pending = new Map<string, { name: string, input: Json }>()
  for (const line of lines) {
    if (!line || !line.includes('"type"')) continue
    let d: Json
    try { d = JSON.parse(line) }
    catch { continue }
    if (d.isSidechain) continue
    const content = d.message && d.message.content
    if (d.type === 'user') {
      if (typeof content === 'string') { pending.clear(); continue }
      if (!Array.isArray(content)) continue
      for (const part of content) {
        if (part.type === 'tool_result') pending.delete(part.tool_use_id)
        else if (part.type === 'text' && !d.isMeta) pending.clear()
      }
    } else if (d.type === 'assistant' && Array.isArray(content)) {
      for (const part of content) if (part.type === 'tool_use' && part.id) pending.set(part.id, { name: part.name, input: part.input })
    }
  }
  const first = pending.values().next().value
  return first ? claudeToolDetail(String(first.name || ''), first.input, home) : null
}

// ------------------------------------------------------------ Codex
// `["bash", "-lc", "script"]` → le script ; sinon les arguments joints.
function shellText(cmd: unknown): string {
  if (Array.isArray(cmd)) {
    const a = cmd.map(String)
    if (a.length === 3 && /(?:^|\/)(?:ba|z|)sh$/.test(a[0]!) && /^-l?c$/.test(a[1]!)) return a[2]!
    return a.join(' ')
  }
  return String(cmd || '')
}

export function codexPatchDetail(patch: string): PromptDetail {
  const files = [...patch.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)].map(m => m[1]!.trim())
  let added = 0
  let removed = 0
  for (const l of patch.split('\n')) {
    if (/^\+(?!\+\+)/.test(l)) added++
    else if (/^-(?!--)/.test(l)) removed++
  }
  return { tool: 'apply_patch', file: files.join(', ') || undefined, added, removed, ...body(patch) }
}

export function pendingCodexTool(lines: string[]): PromptDetail | null {
  const pending = new Map<string, Json>()
  for (const line of lines) {
    if (!line || !line.includes('response_item')) continue
    let d: Json
    try { d = JSON.parse(line) }
    catch { continue }
    const p = d.type === 'response_item' && d.payload
    if (!p) continue
    if (p.type === 'message' && p.role === 'user') pending.clear()
    else if ((p.type === 'function_call' || p.type === 'custom_tool_call' || p.type === 'local_shell_call') && p.call_id) pending.set(p.call_id, p)
    else if (/_output$/.test(p.type || '') && p.call_id) pending.delete(p.call_id)
  }
  const p = pending.values().next().value
  if (!p) return null
  if (p.type === 'custom_tool_call') {
    const input = String(p.input || '')
    if (p.name === 'apply_patch' || input.includes('*** Begin Patch')) return codexPatchDetail(input)
    return { tool: p.name || 'tool', ...body(input) }
  }
  let a: Json = {}
  if (p.arguments) {
    try { a = JSON.parse(p.arguments) }
    catch { return { tool: p.name || 'shell', ...body(String(p.arguments)) } }
  } else if (p.action) a = { command: p.action.command, workdir: p.action.working_directory }
  const cmd = shellText(a.cmd ?? a.command)
  if (!cmd) return { tool: p.name || 'tool', ...body(JSON.stringify(a, null, 2)) }
  return { tool: p.name || 'shell', description: a.justification || undefined, ...body(cmd) }
}

// ------------------------------------------------------------ écran
function dedent(lines: string[]): string[] {
  const ind = Math.min(...lines.filter(l => l.trim()).map(l => l.match(/^\s*/)![0].length))
  return lines.map(l => l.slice(Number.isFinite(ind) ? ind : 0).replace(/\s+$/, ''))
}
function trimBlank(lines: string[]): string[] {
  let a = 0
  let b = lines.length
  while (a < b && !lines[a]!.trim()) a++
  while (b > a && !lines[b - 1]!.trim()) b--
  return lines.slice(a, b)
}
// Une phrase (la description) plutôt qu'une ligne de commande.
const prose = (l: string) => /^[A-Z][^$|&;<>`=\\{}[\]]*$/.test(l.trim()) && /\s/.test(l.trim())

// Codex : « Reason: … » et « $ commande » entre la question et les options.
function codexScreen(between: string[]): PromptDetail | null {
  const lines = trimBlank(dedent(between))
  let description: string | undefined
  const cmd: string[] = []
  let inCmd = false
  for (const l of lines) {
    const r = l.match(/^Reason:\s*(.*)$/)
    if (r) { description = r[1]!; inCmd = false; continue }
    const c = l.match(/^\$\s(.*)$/)
    if (c) { cmd.push(c[1]!); inCmd = true; continue }
    if (inCmd && l.trim()) cmd.push(l)
    else inCmd = false
  }
  if (!cmd.length && !description) return null
  return { tool: 'shell', description, ...(cmd.length ? body(cmd.join('\n')) : {}) }
}

// Claude : bloc entre le dernier trait plein au-dessus de la question et elle.
function claudeScreen(lines: string[], q: number): PromptDetail | null {
  let b = -1
  for (let i = q - 1; i >= Math.max(0, q - 40); i--) if (RULE.test(lines[i]!)) { b = i; break }
  if (b < 0) return null
  const block = trimBlank(dedent(lines.slice(b + 1, q)))
  if (block.length < 2) return null
  const title = block[0]!.trim()
  if (title.length > 60) return null
  const rest = trimBlank(block.slice(1))
  if (rest.some(l => DASHED.test(l)) || /\bfile\b/i.test(title)) {
    // Fichier : chemin puis extrait du diff (numéros de ligne, +/-).
    const content = rest.filter(l => !DASHED.test(l))
    const fi = content.findIndex(l => l.trim() && !/\s{2}/.test(l.trim()) && !/^\s*\d+\s/.test(l))
    const file = fi >= 0 ? content[fi]!.trim() : undefined
    const diff = trimBlank(dedent(content.filter((_, i) => i !== fi)))
    const added = diff.filter(l => /^\s*\d+\s*\+/.test(l)).length
    const removed = diff.filter(l => /^\s*\d+\s*-/.test(l)).length
    return { tool: title, file, ...(added || removed ? { added, removed } : {}), ...(diff.length ? body(diff.join('\n')) : {}) }
  }
  // Commande : premier paragraphe (commande, puis sa description s'il y en a une).
  const blank = rest.findIndex(l => !l.trim())
  const first = trimBlank(dedent(blank < 0 ? rest : rest.slice(0, blank)))
  if (!first.length) return { tool: title }
  let description: string | undefined
  if (first.length >= 2 && prose(first[first.length - 1]!)) description = first.pop()!.trim()
  return { tool: title, description, ...body(first.join('\n')) }
}

// `q` : ligne de la question, `top` : première option (écran déjà débarrassé
// d'un éventuel panneau voisin).
export function screenDetail(lines: string[], q: number, top: number): PromptDetail | null {
  if (q < 0) return null
  return codexScreen(lines.slice(q + 1, top)) || claudeScreen(lines, q)
}

// La transcription donne la commande entière ; l'écran complète ce qui manque.
export function mergeDetail(tr: PromptDetail | null, screen: PromptDetail | null): PromptDetail | null {
  if (!tr) return screen
  if (!screen) return tr
  return { ...tr, description: tr.description || screen.description }
}
