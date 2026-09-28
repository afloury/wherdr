// Transcriptions des agents, pour la vue « Conversation » : la vraie
// conversation, en texte réagencé à la largeur du téléphone, sans toucher au
// terminal (donc sans redimensionner le pane que l'ordinateur regarde).
//
// Retrouver le fichier d'un pane :
//  - identifiant de session transmis par l'intégration Herdr de l'agent
//    (`herdr integration install claude|codex`) : exact, suit /clear.
//  - Claude Code sans intégration : Herdr donne le PID du processus `claude` du
//    pane, et Claude tient ~/.claude/sessions/<pid>.json -> { sessionId, cwd }.
//    Le fichier est ~/.claude/projects/<cwd encodé>/<sessionId>.jsonl.
//  - Codex sans intégration : pas de table PID -> session lisible depuis le
//    conteneur (/proc de l'hôte est fermé par AppArmor). On prend la rollout
//    principale (thread_source "user", sans parent) du même cwd, modifiée en
//    dernier. Ambigu seulement si deux Codex tournent dans le même dossier.
import path from 'node:path'
import type { ChatItem, ChatResponse, ClaudeQueueEntry, ModelInfo, PromptDetail } from '../../shared/types'
import { pendingClaudeTool, pendingCodexTool } from './promptDetail'
import { cleanModelName, lastModel } from './models'
import { type MachineFs, localFs } from './fsx'
import { searchFile } from './conversationSearch'
import { transcriptKind } from '../../shared/agentKind'

// Lecture à rebours par fenêtres jusqu'à avoir assez de messages : les
// transcriptions de Claude embarquent les images en base64, quelques captures
// pèsent plusieurs Mo pour trois lignes de conversation.
const WINDOW_BYTES = 2 * 1024 * 1024
const MAX_READ_BYTES = 24 * 1024 * 1024 // par requête
const PAGE_ITEMS = 120
const MAX_TEXT = 20000

export interface TranscriptPane {
  id: string
  agent: string | null
  cwd: string | null
  agentSession?: string | null
  bornAt?: number
}

interface Loc { file: string, session: string, guessed?: boolean }
interface CodexRollout { file: string, id: string, ts: number, mtimeMs: number }
// Fenêtre où la conversation d'un Codex est créée autour de son apparition.
const CODEX_BIRTH_BEFORE = 5000
const CODEX_BIRTH_AFTER = 120000
type Lines = string[] & { refs?: string[] }
type Parsed = ChatItem[] & { queue?: ClaudeQueueEntry[] }
interface TailResult { start: number, items: ChatItem[], queue: ClaudeQueueEntry[] }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HerdrCall = (method: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<any>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

const clip = (s: string, n = MAX_TEXT) => (s.length > n ? s.slice(0, n) + '…' : s)
const firstLine = (s: unknown) => String(s || '').split('\n').find(l => l.trim()) || ''

// Messages « techniques » injectés dans le fil (rappels système, sorties de
// commandes locales…) : pas des vrais messages de l'utilisateur.
const isNoise = (t: string) => /^\s*<(?!command-name)[a-z_-]+[\s>]/i.test(t) || /^\s*Caveat:/.test(t)
const stripImageTags = (t: unknown) => String(t || '').replace(/\[Image #\d+\]\s*/g, '').trim()
// Texte collé (un envoi multi-lignes de wherdr en est un) : Claude Code
// l'enveloppe dans <pasted_content id="…">…</pasted_content id="…">. C'est un
// vrai message de l'utilisateur : on garde le texte, sans les balises.
const PASTED = /<pasted_content(?:\s[^>]*)?>\n?|\n?<\/pasted_content(?:\s[^>]*)?>/g
export const unwrapPasted = (t: string) => (t.includes('<pasted_content') ? t.replace(PASTED, '').trim() : t)
// Un message écrit par l'utilisateur (après retrait des enveloppes de collage).
function humanText(t: unknown): string | null {
  const s = String(t || '')
  const u = unwrapPasted(s)
  if (u !== s) return u
  return isNoise(s) ? null : s
}
// Même message ? (espaces, casse et images ignorés ; Claude peut en regrouper
// plusieurs en un tour, d'où une inclusion plutôt qu'une égalité).
const normMsg = (t: string) => stripImageTags(t).replace(/\s+/g, ' ').trim().toLowerCase()
export function sameMsg(queued: string, said: string): boolean {
  const q = normMsg(queued).slice(0, 60)
  return Boolean(q) && normMsg(said).includes(q)
}

// Les images en base64 (Claude : source.data, Codex : data:image/…) : on
// les vide avant JSON.parse, seul leur nombre nous intéresse.
export const stripBlobs = (line: string) => (line.length > 50000
  ? line.replace(/"data":"[A-Za-z0-9+/=]{500,}"/g, '"data":""').replace(/"data:image\/[^"]{500,}"/g, '""')
  : line)

export function toolSummary(name: string, input: Json, home = ''): string {
  const i = input || {}
  const shortPath = (p: unknown) => (home ? String(p || '').replace(home, '~') : String(p || ''))
  switch (name) {
    case 'Bash': return i.description || firstLine(i.command)
    case 'Read': case 'Write': case 'Edit': case 'MultiEdit': case 'NotebookEdit':
      return shortPath(i.file_path || i.notebook_path)
    case 'Grep': return `${i.pattern || ''}${i.path ? ' · ' + shortPath(i.path) : ''}`
    case 'Glob': return i.pattern || ''
    case 'WebFetch': return i.url || ''
    case 'WebSearch': return i.query || ''
    case 'Task': case 'Agent': return i.description || firstLine(i.prompt)
    case 'TodoWrite': return `${(i.todos || []).length} tâches`
    case 'AskUserQuestion': return firstLine((i.questions && i.questions[0] && i.questions[0].question) || '')
    default: {
      const v = Object.values(i).find(x => typeof x === 'string')
      return firstLine(v || '')
    }
  }
}

// Les menus /model et /effort peuvent être ouverts puis annulés pour lire leur
// contenu. On ne montre que les confirmations d'un vrai changement, sous forme
// de ligne système. « Kept model as … » et « Cancelled » restent invisibles.
const isPickerCmd = (name: string) => /^\/(?:model|effort)$/.test(name.trim())
function modelChange(text: unknown): string | null {
  const m = String(text || '').match(/<local-command-stdout>\s*Set model to\s+`([^`]+)`/)
  return m ? `/model → ${cleanModelName(m[1]!)}` : null
}
function effortChange(text: unknown): string | null {
  const m = String(text || '').match(/<local-command-stdout>\s*(Set effort level to (low|medium|high|xhigh|max|ultracode)\b[\s\S]*?)<\/local-command-stdout>/i)
  if (!m) return null
  return /\((?:for )?this session only\)/i.test(m[1]!)
    ? `Effort : ${m[2]!.toLowerCase()} (cette session)`
    : m[1]!.trim()
}

// Commandes « ! » (mode bash de Claude Code) : <bash-input>cmd</bash-input>,
// puis un message <bash-stdout>…</bash-stdout><bash-stderr>…</bash-stderr>.
// Sorties des commandes locales : <local-command-stdout|stderr>.
const MAX_OUT = 8000
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g
const tagText = (s: string, tag: string) => {
  const m = s.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))
  return m ? m[1]! : null
}
const cleanOut = (s: string | null) => clip(String(s || '').replace(ANSI, '').replace(/\r\n?/g, '\n').replace(/^\n+|\s+$/g, ''), MAX_OUT)
export function bashInput(text: string): string | null {
  const m = String(text || '').match(/^\s*<bash-input>([\s\S]*?)<\/bash-input>\s*$/)
  return m ? m[1]!.trim() : null
}
export function commandOutput(text: string): { out: string, err: string } | null {
  const s = String(text || '')
  if (!/^\s*<(?:bash-std(?:out|err)|local-command-std(?:out|err))>/.test(s)) return null
  const out = tagText(s, 'bash-stdout') ?? tagText(s, 'local-command-stdout')
  const err = tagText(s, 'bash-stderr') ?? tagText(s, 'local-command-stderr')
  return { out: cleanOut(out), err: cleanOut(err) }
}

export function parseClaude(lines: Lines, home = ''): Parsed {
  const items: Parsed = []
  const tools = new Map<string, ChatItem>()
  // File d'attente de Claude lui-même (messages tapés pendant qu'il travaille,
  // depuis le téléphone ou l'ordinateur) : enqueue, puis dequeue (pris en fin de
  // tour) ou remove « absorbed_mid_turn » (pris en cours de tour).
  const queue: ClaudeQueueEntry[] = []
  let started: ClaudeQueueEntry | null = null
  // Un message de l'utilisateur apparaît : il sort de la file, même sans
  // dequeue ; sinon, la tête de file est peut-être ce message, modifié.
  const said = (text: string, ts: string | null) => {
    const before = queue.length
    for (let i = queue.length - 1; i >= 0; i--) {
      const q = queue[i]!
      if ((!q.ts || !ts || q.ts <= ts) && sameMsg(q.text, text)) queue.splice(i, 1)
    }
    const head = queue.find(q => !isNoise(q.text))
    if (queue.length === before && head && (!head.ts || !ts || head.ts <= ts)) started = head
  }
  // Commande (« ! » ou « / ») qui attend sa sortie : le message suivant.
  let open: ChatItem | null = null
  const pushCmd = (it: ChatItem) => {
    items.push(it)
    open = it
  }
  // Sortie de la commande juste avant ; ailleurs (menus /model, /effort…) ignorée.
  const output = (text: string) => {
    const o = commandOutput(text)
    if (!o) return false
    if (open && items[items.length - 1] === open && open.out === undefined) {
      open.out = o.out
      open.err = o.err
    }
    open = null
    return true
  }
  // Message texte « spécial » (commande, sortie) : traité ici.
  const special = (text: string, ts: string | null) => {
    const bash = bashInput(text)
    if (bash !== null) {
      pushCmd({ role: 'bash', text: clip(bash, 2000), ts })
      said(bash, ts)
      return true
    }
    return output(text)
  }
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    const ref = lines.refs ? lines.refs[li] : undefined
    if (!line) continue
    let d: Json
    try { d = JSON.parse(line) }
    catch { continue }
    if (d.type === 'queue-operation') {
      const text = stripImageTags(unwrapPasted(String(d.content || '')))
      if (d.operation === 'enqueue') queue.push({ text, ts: d.timestamp || null })
      else {
        const i = queue.findIndex(q => q.text === text)
        queue.splice(i >= 0 ? i : 0, 1)
        if (queue[0] !== started) started = null
      }
      continue
    }
    // Fin de tour : l'entrée de tête prise par ce tour sans trace dans la file
    // (pas de dequeue, texte modifié) a été traitée.
    if (d.type === 'system' && d.subtype === 'turn_duration') {
      if (started) queue.splice(queue.indexOf(started), 1)
      started = null
      continue
    }
    if (d.isSidechain || d.isMeta) continue
    const ts: string | null = d.timestamp || null
    // Message pris en cours de tour : écrit comme pièce jointe, pas comme message.
    if (d.type === 'attachment' && d.attachment && d.attachment.type === 'queued_command'
      && d.attachment.commandMode === 'prompt' && (d.attachment.origin || {}).kind === 'human') {
      const parts: Json[] = Array.isArray(d.attachment.prompt) ? d.attachment.prompt : [{ type: 'text', text: String(d.attachment.prompt || '') }]
      const text = stripImageTags(unwrapPasted(parts.filter(p => p.type === 'text').map(p => p.text).join('\n')))
      const images = parts.filter(p => p.type === 'image').length
      if (text || images) {
        items.push({ role: 'user', text: clip(text), images, ref: images ? ref : undefined, ts: d.attachment.timestamp || ts })
        said(text, d.attachment.timestamp || ts)
      }
      continue
    }
    if (d.type === 'system' && d.subtype === 'compact_boundary') {
      items.push({ role: 'system', text: 'Conversation compactée', ts })
      continue
    }
    // Commande locale (/context, /usage…) : les versions récentes de Claude Code
    // l'écrivent comme message système, sans sa sortie (lue à l'écran).
    if (d.type === 'system' && d.subtype === 'local_command' && typeof d.content === 'string') {
      const cmd = d.content.match(/<command-name>([^<]*)<\/command-name>/)
      const changed = effortChange(d.content) || modelChange(d.content)
      if (changed) items.push({ role: 'system', text: changed, ts })
      else if (cmd && !isPickerCmd(cmd[1]!)) {
        const args = (d.content.match(/<command-args>([^<]*)<\/command-args>/) || [])[1] || ''
        pushCmd({ role: 'cmd', text: `${cmd[1]} ${args}`.trim(), ts })
      } else if (cmd) open = null
      else output(d.content)
      continue
    }
    if (d.type !== 'user' && d.type !== 'assistant') continue
    const content = d.message && d.message.content
    if (d.type === 'user') {
      if (d.isCompactSummary) continue
      if (typeof content === 'string') {
        const cmd = content.match(/<command-name>([^<]*)<\/command-name>/)
        const changed = effortChange(content) || modelChange(content)
        if (changed) items.push({ role: 'system', text: changed, ts })
        else if (cmd && isPickerCmd(cmd[1]!)) open = null
        else if (cmd) {
          const args = (content.match(/<command-args>([^<]*)<\/command-args>/) || [])[1] || ''
          pushCmd({ role: 'cmd', text: `${cmd[1]} ${args}`.trim(), ts })
        } else if (special(content, ts)) {
          continue
        } else if (/^\[Request interrupted/.test(content)) {
          items.push({ role: 'system', text: 'Interrompu', ts })
        } else {
          const text = humanText(content)
          if (text) {
            items.push({ role: 'user', text: clip(text), ts })
            said(text, ts)
          }
        }
        continue
      }
      if (!Array.isArray(content)) continue
      let text = ''
      let images = 0
      for (const part of content) {
        if (part.type === 'tool_result') {
          const t = tools.get(part.tool_use_id)
          if (t && part.is_error) t.error = true
        } else if (part.type === 'text') {
          if (special(String(part.text || ''), ts)) continue
          const t = humanText(part.text)
          if (t === null) continue
          if (/^\[Request interrupted/.test(t)) items.push({ role: 'system', text: 'Interrompu', ts })
          else text += (text ? '\n' : '') + unwrapPasted(t.replace(/\[Image #\d+\]\s*/g, ''))
        } else if (part.type === 'image') images++
      }
      if (text.trim() || images) {
        items.push({ role: 'user', text: clip(text.trim()), images, ref: images ? ref : undefined, ts })
        said(text, ts)
      }
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (part.type === 'text' && part.text.trim()) {
          items.push({ role: 'assistant', text: clip(part.text), ts })
        } else if (part.type === 'tool_use') {
          const t: ChatItem = { role: 'tool', name: part.name, text: clip(toolSummary(part.name, part.input, home), 300), ts }
          tools.set(part.id, t)
          items.push(t)
        }
      }
    }
  }
  // Notifications de tâches en file : pas des messages de l'utilisateur.
  items.queue = queue.filter(q => !isNoise(q.text))
  return items
}

export function codexCommand(input: unknown): string {
  const s = String(input || '')
  const m = s.match(/\bcmd\s*:\s*"((?:[^"\\]|\\.)*)"/) || s.match(/\bcmd\s*:\s*'((?:[^'\\]|\\.)*)'/) || s.match(/\bcmd\s*:\s*`([^`]*)`/)
  if (m) {
    try { return JSON.parse(`"${m[1]}"`) }
    catch { return m[1]! }
  }
  // Script sans commande shell : on nomme l'outil appelé (write_stdin, apply_patch…).
  const t = s.match(/\btools\.(\w+)\s*\(/)
  if (t) return t[1]!
  return firstLine(s)
}

export function parseCodex(lines: Lines): Parsed {
  const items: Parsed = []
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    const ref = lines.refs ? lines.refs[li] : undefined
    if (!line) continue
    let d: Json
    try { d = JSON.parse(line) }
    catch { continue }
    if (d.type !== 'response_item' || !d.payload) continue
    const p = d.payload
    const ts: string | null = d.timestamp || null
    if (p.type === 'message' && (p.role === 'user' || p.role === 'assistant')) {
      let text = ''
      let images = 0
      for (const part of p.content || []) {
        if ((part.type === 'input_text' || part.type === 'output_text') && part.text && !isNoise(part.text)) text += (text ? '\n' : '') + part.text
        else if (part.type === 'input_image') images++
      }
      if (text.trim() || images) items.push({ role: p.role, text: clip(text.trim()), images, ref: images ? ref : undefined, ts })
    } else if (p.type === 'custom_tool_call' || p.type === 'function_call' || p.type === 'local_shell_call') {
      let summary: unknown = ''
      if (p.type === 'custom_tool_call') summary = codexCommand(p.input)
      else if (p.arguments) {
        try {
          const a = JSON.parse(p.arguments)
          summary = Array.isArray(a.command) ? a.command.join(' ') : a.cmd || a.command || firstLine(p.arguments)
        } catch { summary = firstLine(p.arguments) }
      } else if (p.action && p.action.command) summary = ([] as string[]).concat(p.action.command).join(' ')
      items.push({ role: 'tool', name: p.name || 'shell', text: clip(String(summary), 300), ts })
    }
  }
  return items
}

// `base` : position (en octets) de `text` dans le fichier. Chaque ligne garde
// sa position « début:longueur » (lines.refs) : les messages avec images la
// portent, pour relire l'image à la demande (cf. image()).
export function parseLines(text: string, kind: string | null, base = 0, home = ''): Parsed {
  const raw = text.split('\n')
  const refs: string[] = []
  let off = base
  for (const l of raw) {
    const n = Buffer.byteLength(l)
    refs.push(`${off}:${n}`)
    off += n + 1
  }
  const lines: Lines = raw.map(stripBlobs)
  lines.refs = refs
  return kind === 'codex' ? parseCodex(lines) : parseClaude(lines, home)
}

// Types servis tels quels : une image SVG (ou un type quelconque écrit dans la
// transcription) ouverte depuis wherdr exécuterait ses scripts sur son origine.
const IMAGE_TYPES = /^image\/(?:png|jpeg|gif|webp)$/

// Première image n° `index` d'une ligne JSON de transcription (Claude ou Codex).
export function extractImage(d: Json, index: number): { type: string, body: Buffer } | null {
  const found: { type: string, data: string }[] = []
  const visit = (parts: Json[] | null) => {
    for (const p of parts || []) {
      if (p && p.type === 'image' && p.source && p.source.data) found.push({ type: p.source.media_type || 'image/png', data: p.source.data })
      else if (p && p.type === 'input_image') {
        const u = typeof p.image_url === 'string' ? p.image_url : p.image_url && p.image_url.url
        const mm = /^data:(image\/[\w.+-]+);base64,(.+)$/.exec(u || '')
        if (mm) found.push({ type: mm[1]!, data: mm[2]! })
      }
    }
  }
  visit(d.message && Array.isArray(d.message.content) ? d.message.content : null)
  visit(d.attachment && Array.isArray(d.attachment.prompt) ? d.attachment.prompt : null)
  visit(d.payload && Array.isArray(d.payload.content) ? d.payload.content : null)
  const img = found[index]
  if (!img) return null
  const type = String(img.type).toLowerCase()
  return { type: IMAGE_TYPES.test(type) ? type : 'application/octet-stream', body: Buffer.from(img.data, 'base64') }
}

// `fs` : disque de la machine où tournent les agents (local, ou distant par SSH).
export function createTranscripts({ home, herdr, fs = localFs }: { home: string, herdr: HerdrCall, fs?: MachineFs }) {
  const locCache = new Map<string, { at: number, loc: Loc | null, session?: string | null }>()
  const parseCache = new Map<string, { size: number, r: TailResult }>()
  const metaCache = new Map<string, Json>()

  // ------------------------------------------------------------ localisation
  async function paneProcess(paneId: string, kind: string) {
    const r = await herdr('pane.process_info', { pane_id: paneId }, 4000)
    const procs: Json[] = (r.process_info && r.process_info.foreground_processes) || []
    const match = procs.find(p => p.name === kind || path.basename((p.argv && p.argv[0]) || '') === kind)
    return match || procs[0] || null
  }

  const encodeCwd = (cwd: string) => cwd.replace(/[^A-Za-z0-9]/g, '-')

  async function exists(f: string) {
    try { return (await fs.stat(f)).isFile }
    catch { return false }
  }
  // Premier fichier existant parmi `files` (un seul aller-retour à distance).
  async function firstExisting(files: string[]) {
    if (!files.length) return null
    const st = await fs.statMany(files)
    const i = st.findIndex(s => s && s.isFile)
    return i < 0 ? null : files[i]!
  }
  async function listDir(d: string) {
    try { return await fs.readdir(d) }
    catch { return [] }
  }

  async function locateClaude(proc: { pid: number }): Promise<Loc | null> {
    let sess: Json
    try { sess = JSON.parse(await fs.readFile(path.join(home, '.claude/sessions', `${proc.pid}.json`))) }
    catch { return null }
    if (!sess.sessionId) return null
    const direct = path.join(home, '.claude/projects', encodeCwd(sess.cwd || ''), `${sess.sessionId}.jsonl`)
    if (await exists(direct)) return { file: direct, session: sess.sessionId }
    // Encodage du dossier différent de celui supposé : on cherche le fichier.
    const root = path.join(home, '.claude/projects')
    const f = await firstExisting((await listDir(root)).map(d => path.join(root, d, `${sess.sessionId}.jsonl`)))
    return f ? { file: f, session: sess.sessionId } : null
  }

  async function rolloutMeta(file: string) {
    if (metaCache.has(file)) return metaCache.get(file)
    let meta: Json = null
    try {
      const first = (await fs.read(file, 0, 64 * 1024)).toString('utf8').split('\n')[0]!
      const d = JSON.parse(first)
      if (d.type === 'session_meta') meta = d.payload
    } catch { meta = null }
    // Une ligne incomplète (fichier tout neuf) : on réessaiera plus tard.
    if (meta) metaCache.set(file, meta)
    return meta
  }

  // Conversations Codex principales (thread_source « user », sans parent) des
  // trois derniers jours dans `cwd`.
  async function codexRollouts(cwd: string | null) {
    const root = path.join(home, '.codex/sessions')
    const files: string[] = []
    const now = new Date()
    for (let back = 0; back < 3; back++) {
      const d = new Date(now.getTime() - back * 86400000)
      const dir = path.join(root, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'))
      for (const n of await listDir(dir)) if (n.startsWith('rollout-') && n.endsWith('.jsonl')) files.push(path.join(dir, n))
    }
    const stats = files.length ? await fs.statMany(files) : []
    const out: CodexRollout[] = []
    for (let i = 0; i < files.length; i++) {
      const st = stats[i]
      if (!st) continue
      const meta = await rolloutMeta(files[i]!)
      if (!meta || !meta.id || meta.parent_thread_id || (meta.thread_source && meta.thread_source !== 'user')) continue
      if (cwd && meta.cwd !== cwd) continue
      out.push({ file: files[i]!, id: meta.id, ts: Date.parse(meta.timestamp || 0) || 0, mtimeMs: st.mtimeMs })
    }
    return out
  }

  // Codex récent (app-server partagé, « managed daemon ») : le hook de session
  // de l'intégration Herdr tourne dans le démon, avec l'environnement du premier
  // Codex qui l'a lancé ; la session d'un nouveau Codex est alors rapportée au
  // pane de ce premier Codex. On ne s'y fie donc pas aveuglément : chaque Codex
  // réclame la conversation créée juste après son apparition (`bornAt`), et une
  // session rapportée qui est la « naissance » d'un autre pane est ignorée.
  async function locateCodexPane(pane: TranscriptPane): Promise<Loc | null> {
    const rolls = await codexRollouts(pane.cwd)
    const birth = (p: TranscriptPane) => {
      if (!p.bornAt) return null
      let best: CodexRollout | null = null
      for (const r of rolls) {
        if (r.ts < p.bornAt - CODEX_BIRTH_BEFORE || r.ts > p.bornAt + CODEX_BIRTH_AFTER) continue
        if (!best || r.ts < best.ts) best = r
      }
      return best
    }
    const others = [...codexPeers.values()].filter(o => o.id !== pane.id && o.agent === 'codex' && o.cwd === pane.cwd)
    const taken = new Set(others.map(o => birth(o)?.id).filter(Boolean) as string[])
    if (pane.agentSession && !taken.has(pane.agentSession)) {
      const f = await findSessionFile('codex', pane.agentSession)
      if (f) return { file: f, session: pane.agentSession }
    }
    let best: CodexRollout | null = null
    for (const r of rolls) {
      if (taken.has(r.id)) continue
      if (pane.bornAt && r.ts < pane.bornAt - 60000) continue
      if (!best || r.mtimeMs > best.mtimeMs) best = r
    }
    return best && { file: best.file, session: best.id, guessed: true }
  }

  // Panes Codex de la machine (tenu à jour par l'état) : pour les réclamations.
  const codexPeers = new Map<string, TranscriptPane>()
  function observe(panes: TranscriptPane[]) {
    codexPeers.clear()
    for (const p of panes) if (p.agent === 'codex') codexPeers.set(p.id, p)
  }

  // Fichier d'une session connue par son identifiant (intégration Herdr).
  const bySession = new Map<string, string>()
  async function findSessionFile(kind: string | null, id: string) {
    const known = bySession.get(id)
    if (known) {
      if (await exists(known)) return known
      bySession.delete(id)
    }
    let found: string | null = null
    if (kind === 'codex') {
      // ~/.codex/sessions/AAAA/MM/JJ/rollout-<date>-<id>.jsonl, du plus récent au plus ancien.
      const root = path.join(home, '.codex/sessions')
      const sortDesc = async (d: string) => (await listDir(d)).sort().reverse()
      outer:
      for (const y of await sortDesc(root)) {
        for (const m of await sortDesc(path.join(root, y))) {
          for (const d of await sortDesc(path.join(root, y, m))) {
            const dir = path.join(root, y, m, d)
            const hit = (await sortDesc(dir)).find(n => n.endsWith(`-${id}.jsonl`))
            if (hit) { found = path.join(dir, hit); break outer }
          }
        }
      }
    } else if (kind === 'claude') {
      const root = path.join(home, '.claude/projects')
      found = await firstExisting((await listDir(root)).map(d => path.join(root, d, `${id}.jsonl`)))
    }
    if (found) bySession.set(id, found)
    return found
  }

  async function locate(pane: TranscriptPane): Promise<Loc | null> {
    const hit = locCache.get(pane.id)
    if (hit && Date.now() - hit.at < 8000 && hit.session === pane.agentSession) return hit.loc
    let loc: Loc | null = null
    try {
      if (pane.agent === 'codex') loc = await locateCodexPane(pane)
      else if (pane.agentSession) {
        const f = await findSessionFile(pane.agent, pane.agentSession)
        if (f) loc = { file: f, session: pane.agentSession }
      }
      if (!loc && pane.agent === 'claude') {
        const proc = await paneProcess(pane.id, 'claude')
        if (proc) loc = await locateClaude(proc)
      }
    } catch { loc = null }
    locCache.set(pane.id, { at: Date.now(), loc, session: pane.agentSession })
    return loc
  }

  // ------------------------------------------------------------ lecture
  // Lit les octets [start, end) du fichier. Si `start` tombe au milieu d'une
  // ligne, on la saute : `start` renvoyé est toujours un début de ligne.
  async function readRange(file: string, start: number, end: number) {
    const buf = await fs.read(file, start, end - start)
    let off = 0
    if (start > 0) {
      const nl = buf.indexOf(0x0a)
      off = nl < 0 ? buf.length : nl + 1
    }
    return { start: start + off, text: buf.subarray(off).toString('utf8') }
  }

  // Remonte depuis `end` par fenêtres jusqu'à PAGE_ITEMS messages (ou le début).
  async function readBackwards(file: string, end: number, kind: string | null): Promise<TailResult> {
    let start = end
    let items: ChatItem[] = []
    let queue: ClaudeQueueEntry[] | null = null
    while (start > 0 && end - start < MAX_READ_BYTES) {
      // Fenêtre élargie tant qu'elle ne contient pas de début de ligne (une
      // ligne de plusieurs Mo : message avec images), dans la limite du plafond.
      let w = WINDOW_BYTES
      let r: { start: number, text: string }
      for (;;) {
        const s0 = Math.max(0, start - w)
        r = await readRange(file, s0, start)
        if (r.start < start || s0 === 0 || w >= MAX_READ_BYTES) break
        w *= 2
      }
      if (r.start === start) break // ligne géante au-delà du plafond : on s'arrête là
      // Chaque fenêtre est analysée seule (un résultat d'outil en erreur dont
      // l'appel est dans la fenêtre précédente perd juste sa marque rouge).
      const parsed = parseLines(r.text, kind, r.start, home)
      if (!queue) queue = parsed.queue || [] // la file vit dans la fenêtre la plus récente
      items = parsed.concat(items)
      start = r.start
      if (items.length >= PAGE_ITEMS) break
    }
    return { start, items, queue: queue || [] }
  }

  // Bas de conversation : depuis `from` (déjà affiché côté téléphone) ou,
  // au premier chargement, les PAGE_ITEMS derniers messages. Mis en cache par
  // (fichier, taille, from).
  async function tail(file: string, kind: string | null, size: number, from: number | null): Promise<TailResult> {
    const key = `${file}|${from}`
    const c = parseCache.get(key)
    if (c && c.size === size) return c.r
    let r: TailResult
    if (from !== null && from <= size && size - from <= MAX_READ_BYTES) {
      const x = await readRange(file, from, size)
      const items = parseLines(x.text, kind, x.start, home)
      r = { start: from, items, queue: items.queue || [] }
    } else {
      r = await readBackwards(file, size, kind)
    }
    parseCache.set(key, { size, r })
    if (parseCache.size > 16) parseCache.delete(parseCache.keys().next().value!)
    return r
  }

  // ------------------------------------------------------------ API
  async function search(pane: TranscriptPane, query: string, deadline: number) {
    if (pane.agent !== 'claude' && pane.agent !== 'codex') return { hits: [], limited: false, kind: null }
    const loc = await locate(pane)
    if (!loc || Date.now() >= deadline) return { hits: [], limited: Date.now() >= deadline, kind: null }
    // Le chemin de la transcription dit le vrai type (agent fermé mal étiqueté).
    const kind = transcriptKind(loc.file) || pane.agent
    return { ...await searchFile(fs, loc.file, kind, home, query, deadline), kind }
  }

  // opts.since : jeton du dernier état vu (réponse « inchangé » s'il n'a pas bougé)
  // opts.from   : relire le bas depuis cet octet (continuité avec les pages plus anciennes)
  // opts.before : charger la tranche plus ancienne qui se termine à cet octet
  async function chat(pane: TranscriptPane, opts: { since?: string, from?: number | null, before?: number | null } = {}): Promise<ChatResponse> {
    if (!pane.agent || !['claude', 'codex'].includes(pane.agent)) return { available: false, reason: 'unsupported' }
    const loc = await locate(pane)
    if (!loc) return { available: false, reason: 'not_found' }
    let st
    try { st = await fs.stat(loc.file) }
    catch {
      locCache.delete(pane.id)
      return { available: false, reason: 'not_found' }
    }
    const fileId = path.basename(loc.file)
    const base = { available: true, file: fileId, session: loc.session, guessed: Boolean(loc.guessed) }
    if (opts.before !== null && opts.before !== undefined) {
      const r = await readBackwards(loc.file, Math.min(opts.before, st.size), pane.agent)
      return { ...base, older: true, items: r.items, start: r.start }
    }
    const from = opts.from === undefined ? null : opts.from
    const token = `${fileId}:${st.size}:${from}`
    if (opts.since && opts.since === token) return { ...base, unchanged: true, token }
    const r = await tail(loc.file, pane.agent, st.size, from)
    return { ...base, token, items: r.items, start: r.start, queue: r.queue || [] }
  }

  // Dernière réponse de l'agent, pour les cartes et les notifications.
  async function preview(pane: TranscriptPane): Promise<string | null> {
    try {
      const r = await chat(pane, {})
      if (!r.available || !r.items) return null
      for (let i = r.items.length - 1; i >= 0; i--) {
        const it = r.items[i]!
        if (it.role === 'assistant') {
          return it.text.replace(/```[\s\S]*?```/g, ' ').replace(/[#*_`>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 180)
        }
      }
    } catch { /* pas d'aperçu */ }
    return null
  }

  // Image n° `index` du message situé à `ref` (« début:longueur ») : on relit
  // cette seule ligne et on décode l'image qu'elle contient (base64).
  async function image(pane: TranscriptPane, fileId: string | null, ref: string | null, index: number) {
    const loc = await locate(pane)
    if (!loc || path.basename(loc.file) !== fileId) return null
    const m = /^(\d+):(\d+)$/.exec(String(ref || ''))
    if (!m) return null
    const off = Number(m[1])
    const len = Number(m[2])
    if (len > 60 * 1024 * 1024) return null
    let d: Json
    try { d = JSON.parse((await fs.read(loc.file, off, len)).toString('utf8')) }
    catch { return null }
    return extractImage(d, index)
  }

  // Dernier modèle écrit dans la transcription. Lecture à rebours par fenêtres
  // (jusqu'à MODEL_MAX_BYTES), puis seulement la partie ajoutée depuis.
  const MODEL_WINDOW = 512 * 1024
  const MODEL_MAX_BYTES = 16 * 1024 * 1024
  const modelCache = new Map<string, { file: string, size: number, info: ModelInfo | null }>()
  async function model(pane: TranscriptPane): Promise<ModelInfo | null> {
    if (!pane.agent || !['claude', 'codex'].includes(pane.agent)) return null
    const loc = await locate(pane)
    if (!loc) return null
    let size: number
    try { size = (await fs.stat(loc.file)).size }
    catch { return null }
    const c = modelCache.get(pane.id)
    if (c && c.file === loc.file && c.size === size) return c.info
    let info: ModelInfo | null = null
    let done = size // fin de la dernière ligne complète (une ligne en cours d'écriture sera relue)
    try {
      // Déjà lu jusqu'à c.size : seule la suite peut apporter du nouveau. On
      // part de l'octet d'avant (le saut de ligne) : readRange saute la ligne
      // entamée au début de la fenêtre.
      const floor = c && c.file === loc.file && c.size < size ? c.size : 0
      let end = size
      let w = MODEL_WINDOW
      while (end > floor && size - end < MODEL_MAX_BYTES) {
        const s0 = Math.max(floor ? floor - 1 : 0, end - w)
        const r = await readRange(loc.file, s0, end)
        if (r.start >= end) {
          // Aucune ligne entière dans la fenêtre (message avec images) : on l'élargit.
          if (s0 <= Math.max(0, floor - 1) || w >= MODEL_MAX_BYTES) break
          w *= 2
          continue
        }
        if (end === size && !r.text.endsWith('\n')) done = size - Buffer.byteLength(r.text.slice(r.text.lastIndexOf('\n') + 1))
        info = lastModel(r.text.split('\n').map(stripBlobs), pane.agent)
        if (info) break
        end = r.start
      }
      if (!info && floor && c) info = c.info
    } catch { return c ? c.info : null }
    modelCache.set(pane.id, { file: loc.file, size: done, info })
    return info
  }

  // Appel d'outil qui attend une permission : le dernier sans résultat, lu
  // dans la fin de la transcription (relu seulement si le fichier a grandi).
  const PENDING_WINDOW = 1024 * 1024
  const pendingCache = new Map<string, { file: string, size: number, detail: PromptDetail | null }>()
  async function pendingTool(pane: TranscriptPane): Promise<PromptDetail | null> {
    if (pane.agent !== 'claude' && pane.agent !== 'codex') return null
    const loc = await locate(pane)
    if (!loc) return null
    let size: number
    try { size = (await fs.stat(loc.file)).size }
    catch { return null }
    const c = pendingCache.get(pane.id)
    if (c && c.file === loc.file && c.size === size) return c.detail
    let detail: PromptDetail | null = null
    try {
      const r = await readRange(loc.file, Math.max(0, size - PENDING_WINDOW), size)
      const lines = r.text.split('\n').map(stripBlobs)
      detail = (transcriptKind(loc.file) || pane.agent) === 'codex' ? pendingCodexTool(lines) : pendingClaudeTool(lines, home)
    } catch { detail = null }
    pendingCache.set(pane.id, { file: loc.file, size, detail })
    return detail
  }

  function forget(paneId: string) {
    locCache.delete(paneId)
    modelCache.delete(paneId)
    pendingCache.delete(paneId)
  }

  return { chat, preview, image, forget, locate, model, observe, search, pendingTool }
}

export type Transcripts = ReturnType<typeof createTranscripts>
