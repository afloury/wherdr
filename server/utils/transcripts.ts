// Agent transcripts, for the "Conversation" view: the real
// conversation, as text reflowed to the phone's width, without touching the
// terminal (so without resizing the pane the computer is looking at).
//
// Finding a pane's file:
//  - session identifier passed by the agent's Herdr integration
//    (`herdr integration install claude|codex|omp`): exact, follows /clear. omp
//    reports the path of its session directly.
//  - Claude Code without integration: Herdr gives the PID of the pane's `claude`
//    process, and Claude keeps ~/.claude/sessions/<pid>.json -> { sessionId, cwd }.
//    The file is ~/.claude/projects/<encoded cwd>/<sessionId>.jsonl.
//  - Codex without integration: no PID -> session table readable from the
//    container (the host's /proc is closed by AppArmor). We take the main
//    rollout (thread_source "user", no parent) of the same cwd, modified
//    last. Ambiguous only if two Codex run in the same folder.
import path from 'node:path'
import { imageTagCount } from '../../shared/queuedMatch'
import type { ChatItem, ChatResponse, ClaudeQueueEntry, ModelInfo, PromptDetail } from '../../shared/types'
import { ompToolCall, ompToolResult, ompUserRun } from './ompTools'
import { pendingClaudeTool, pendingCodexTool } from './promptDetail'
import { type ClaudeAsked, type OmpAsked, pendingClaudeAsk, pendingOmpAsk } from './choices'
import { cleanModelName, lastModel, mergeOmpModel, ompLastModel, ompModelComplete, ompModelLabel, ompModelResult } from './models'
import { type MachineFs, localFs } from './fsx'
import { searchFile } from './conversationSearch'
import { hasTranscript, transcriptKind } from '../../shared/agentKind'
import { type CommandTemplate, ompCommandTemplates } from './slash'
import { fmt } from '../../shared/message'

// Backward reading by windows until there are enough messages: Claude's
// transcripts embed images in base64, a few screenshots
// weigh several MB for three lines of conversation.
const WINDOW_BYTES = 2 * 1024 * 1024
const MAX_READ_BYTES = 24 * 1024 * 1024 // per request
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
// Window in which a Codex's conversation is created around its appearance.
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

// "Technical" messages injected into the thread (system reminders, outputs of
// local commands…): not real user messages.
const isNoise = (t: string) => /^\s*<(?!command-name)[a-z_-]+[\s>]/i.test(t) || /^\s*Caveat:/.test(t)
// "[Image #1]" (Claude Code), "[Image #1, 756x477]" (omp).
const stripImageTags = (t: unknown) => String(t || '').replace(/\[Image #\d+(?:, \d+x\d+)?\]\s*/g, '').trim()
// Pasted text (a multi-line send from wherdr is one): Claude Code
// wraps it in <pasted_content id="…">…</pasted_content id="…">. It is a
// real user message: we keep the text, without the tags.
const PASTED = /<pasted_content(?:\s[^>]*)?>\n?|\n?<\/pasted_content(?:\s[^>]*)?>/g
export const unwrapPasted = (t: string) => (t.includes('<pasted_content') ? t.replace(PASTED, '').trim() : t)
// A message written by the user (after removing the paste wrappers).
function humanText(t: unknown): string | null {
  const s = String(t || '')
  const u = unwrapPasted(s)
  if (u !== s) return u
  return isNoise(s) ? null : s
}
// Same message? (spaces, case and images ignored; Claude may group
// several into one turn, hence inclusion rather than equality).
const normMsg = (t: string) => stripImageTags(t).replace(/\s+/g, ' ').trim().toLowerCase()
export function sameMsg(queued: string, said: string): boolean {
  const q = normMsg(queued).slice(0, 60)
  return Boolean(q) && normMsg(said).includes(q)
}

// Base64 images (Claude: source.data, Codex: data:image/…): we
// empty them before JSON.parse, only their count matters to us.
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
    case 'TodoWrite': return fmt('{count} tasks', { count: (i.todos || []).length })
    case 'AskUserQuestion': return firstLine((i.questions && i.questions[0] && i.questions[0].question) || '')
    default: {
      const v = Object.values(i).find(x => typeof x === 'string')
      return firstLine(v || '')
    }
  }
}

// The /model and /effort menus may be opened then cancelled to read their
// content. We only show confirmations of a real change, as a
// system line. "Kept model as …" and "Cancelled" stay invisible.
const isPickerCmd = (name: string) => /^\/(?:model|effort)$/.test(name.trim())
// /clear, /new, /reset: "Conversation cleared" separator, without output (what
// Claude Code writes afterwards is not an output of the command, often a status
// like "Update installed"). /compact keeps its line (its instructions), without
// output either: its separator comes from compact_boundary.
const isResetCmd = (name: string) => /^\/(?:clear|new|reset)$/.test(name.trim())
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

// "!" commands (Claude Code bash mode): <bash-input>cmd</bash-input>,
// then a <bash-stdout>…</bash-stdout><bash-stderr>…</bash-stderr> message.
// Outputs of local commands: <local-command-stdout|stderr>.
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

// Output of a local command reduced to one useful line: never the screen
// text that Claude Code sometimes copies there (spinner, "Running N shell
// command…", tips, update statuses).
const SCREEN_JUNK = /^(?:[*✢✳✶✻✽·⏺●◯○]\s*\S+…|Running \d+ (?:shell )?commands?…?|Tip:|Context Usage$|\(no content\)$|✔?\s*Update installed|Restart to update|.*\besc to interrupt\b|.*\bctrl\+\w+ to\b|⎿)/i
export function usefulOutput(out: string | undefined, err: string | undefined): string | null {
  for (const raw of `${err || ''}\n${out || ''}`.split('\n')) {
    const l = raw.replace(/^[\s⎿]+/, '').trim()
    if (l && !SCREEN_JUNK.test(l)) return clip(l, 160)
  }
  return null
}

// Text Claude Code shows with ● in the terminal. Recent models (Claude
// Code 2.1.28x) also write the short narration between tool calls as a
// signed `thinking` block (after an empty one) rather than a `text` block;
// the terminal displays it like a reply, so the conversation does too.
function assistantText(part: Json): string | null {
  const t = part && (part.type === 'text' ? part.text : part.type === 'thinking' ? part.thinking : null)
  return typeof t === 'string' && t.trim() ? t : null
}

export function parseClaude(lines: Lines, home = ''): Parsed {
  const items: Parsed = []
  const tools = new Map<string, ChatItem>()
  // Claude's own queue (messages typed while it works,
  // from the phone or the computer): enqueue, then dequeue (taken at the end of
  // the turn) or remove "absorbed_mid_turn" (taken during the turn).
  const queue: ClaudeQueueEntry[] = []
  let started: ClaudeQueueEntry | null = null
  // A user message appears: it leaves the queue, even without
  // dequeue; otherwise, the head of the queue may be this message, modified.
  // Photos alone have no text: the oldest photos-only entry leaves the queue
  // when a message with images and no text appears.
  const said = (text: string, ts: string | null, images = 0) => {
    const before = queue.length
    for (let i = queue.length - 1; i >= 0; i--) {
      const q = queue[i]!
      if ((!q.ts || !ts || q.ts <= ts) && sameMsg(q.text, text)) queue.splice(i, 1)
    }
    if (images && !stripImageTags(text)) {
      const i = queue.findIndex(q => !q.text && (q.images || 0) > 0 && (!q.ts || !ts || q.ts <= ts))
      if (i >= 0) queue.splice(i, 1)
    }
    const head = queue.find(q => !isNoise(q.text))
    if (queue.length === before && head && (!head.ts || !ts || head.ts <= ts)) started = head
  }
  // Command ("!" or "/") waiting for its output: the next message.
  let open: ChatItem | null = null
  // "/" command followed by an agent reply (skill, custom command,
  // /review…): it is a user message, not a command block.
  let pendingCmd: ChatItem | null = null
  const pushCmd = (it: ChatItem) => {
    if (/^\/compact\b/.test(it.text)) it.out = ''
    items.push(it)
    open = it
    pendingCmd = it.role === 'cmd' ? it : null
  }
  // Output of the command just before; elsewhere (/model, /effort menus…) ignored.
  const output = (text: string) => {
    const o = commandOutput(text)
    if (!o) return false
    if (open && !open.text) {
      open = null
      return true
    }
    if (open && items[items.length - 1] === open && open.out === undefined) {
      open.out = o.out
      open.err = o.err
    }
    open = null
    return true
  }
  // /clear…: separator, and the following output is swallowed (item without rendering).
  const swallow = (ts: string | null) => {
    items.push({ role: 'system', text: 'Conversation cleared', ts })
    pendingCmd = null
    open = { role: 'system', text: '', ts }
  }
  // "Special" text message (command, output): handled here.
  const special = (text: string, ts: string | null) => {
    const bash = bashInput(text)
    if (bash !== null) {
      pushCmd({ role: 'bash', text: clip(bash, 2000), ts })
      said(bash, ts)
      return true
    }
    return output(text)
  }
  // Last user message typed by the user, with its place in the message tree.
  // Stop before any reply puts the prompt back into Claude's field: the next
  // message is then written as its sibling (same parent), and the cancelled
  // one drops out of the conversation, as in Claude (see interruptRestore.ts).
  let lastSaid = null as { item: ChatItem, parent: string, uuid: string } | null
  const noteSaid = (d: Json) => {
    const item = items[items.length - 1]
    lastSaid = item && item.role === 'user' && d.parentUuid ? { item, parent: d.parentUuid, uuid: d.uuid } : null
  }
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    const ref = lines.refs ? lines.refs[li] : undefined
    if (!line) continue
    let d: Json
    try { d = JSON.parse(line) }
    catch { continue }
    if (lastSaid && d.type === 'user' && !d.isSidechain && d.parentUuid === lastSaid.parent && d.uuid !== lastSaid.uuid) {
      const i = items.indexOf(lastSaid.item)
      if (i >= 0 && !items.slice(i + 1).some(x => x.role === 'assistant' || x.role === 'tool')) items.splice(i, 1)
      lastSaid = null
    }
    if (d.type === 'queue-operation') {
      const raw = unwrapPasted(String(d.content || ''))
      const text = stripImageTags(raw)
      const images = imageTagCount(raw)
      if (d.operation === 'enqueue') queue.push({ text, ts: d.timestamp || null, ...(images ? { images } : {}) })
      else {
        const i = queue.findIndex(q => q.text === text)
        queue.splice(i >= 0 ? i : 0, 1)
        if (queue[0] !== started) started = null
      }
      continue
    }
    // End of turn: the head entry taken by this turn without a trace in the queue
    // (no dequeue, modified text) has been handled.
    if (d.type === 'system' && d.subtype === 'turn_duration') {
      if (started) queue.splice(queue.indexOf(started), 1)
      started = null
      continue
    }
    if (d.isSidechain || d.isMeta) continue
    const ts: string | null = d.timestamp || null
    // Message taken during the turn: written as an attachment, not as a message.
    if (d.type === 'attachment' && d.attachment && d.attachment.type === 'queued_command'
      && d.attachment.commandMode === 'prompt' && (d.attachment.origin || {}).kind === 'human') {
      const parts: Json[] = Array.isArray(d.attachment.prompt) ? d.attachment.prompt : [{ type: 'text', text: String(d.attachment.prompt || '') }]
      const text = stripImageTags(unwrapPasted(parts.filter(p => p.type === 'text').map(p => p.text).join('\n')))
      const images = parts.filter(p => p.type === 'image').length
      if (text || images) {
        items.push({ role: 'user', text: clip(text), images, ref: images ? ref : undefined, ts: d.attachment.timestamp || ts })
        pendingCmd = null
        said(text, d.attachment.timestamp || ts, images)
      }
      continue
    }
    if (d.type === 'system' && d.subtype === 'compact_boundary') {
      items.push({ role: 'system', text: 'Conversation compacted', ts })
      continue
    }
    // Local command (/context, /usage…): recent versions of Claude Code
    // write it as a system message, without its output (read from the screen).
    if (d.type === 'system' && d.subtype === 'local_command' && typeof d.content === 'string') {
      const cmd = d.content.match(/<command-name>([^<]*)<\/command-name>/)
      const changed = effortChange(d.content) || modelChange(d.content)
      if (changed) items.push({ role: 'system', text: changed, ts })
      else if (cmd && isResetCmd(cmd[1]!)) swallow(ts)
      else if (cmd && !isPickerCmd(cmd[1]!)) {
        const args = (d.content.match(/<command-args>([^<]*)<\/command-args>/) || [])[1] || ''
        pushCmd({ role: 'cmd', text: `${cmd[1]} ${args}`.trim(), ts })
      } else if (cmd) open = null
      else output(d.content)
      continue
    }
    if (d.type !== 'user' && d.type !== 'assistant') continue
    const content = d.message && d.message.content
    if (d.type === 'assistant' && pendingCmd && Array.isArray(content) && content.some((c: Json) => c.type === 'tool_use' || assistantText(c))) {
      const c: ChatItem = pendingCmd
      c.role = 'user'
      delete c.out
      delete c.err
      said(c.text, c.ts || null)
      pendingCmd = null
      if (open === c) open = null
    }
    if (d.type === 'user') {
      if (d.isCompactSummary) continue
      if (typeof content === 'string') {
        const cmd = content.match(/<command-name>([^<]*)<\/command-name>/)
        const changed = effortChange(content) || modelChange(content)
        if (changed) items.push({ role: 'system', text: changed, ts })
        else if (cmd && isResetCmd(cmd[1]!)) swallow(ts)
        else if (cmd && isPickerCmd(cmd[1]!)) open = null
        else if (cmd) {
          const args = (content.match(/<command-args>([^<]*)<\/command-args>/) || [])[1] || ''
          pushCmd({ role: 'cmd', text: `${cmd[1]} ${args}`.trim(), ts })
        } else if (special(content, ts)) {
          continue
        } else if (/^\[Request interrupted/.test(content)) {
          items.push({ role: 'system', text: 'Interrupted', ts })
        } else {
          const text = humanText(content)
          if (text) {
            items.push({ role: 'user', text: clip(text), ts })
            pendingCmd = null
            said(text, ts)
            noteSaid(d)
          }
        }
        continue
      }
      if (!Array.isArray(content)) continue
      let text = ''
      let images = 0
      // Images the line's tool results returned come after the message's
      // own (see extractImage).
      let toolImages = content.filter((p: Json) => p && p.type === 'image').length
      for (const part of content) {
        if (part.type === 'tool_result') {
          const t = tools.get(part.tool_use_id)
          if (t && part.is_error) t.error = true
          const n = Array.isArray(part.content) ? part.content.filter((p: Json) => p && p.type === 'image').length : 0
          if (t && n && ref) {
            t.images = n
            t.ref = ref
            if (toolImages) t.imageAt = toolImages
          }
          toolImages += n
        } else if (part.type === 'text') {
          if (special(String(part.text || ''), ts)) continue
          const t = humanText(part.text)
          if (t === null) continue
          if (/^\[Request interrupted/.test(t)) items.push({ role: 'system', text: 'Interrupted', ts })
          else text += (text ? '\n' : '') + unwrapPasted(t.replace(/\[Image #\d+\]\s*/g, ''))
        } else if (part.type === 'image') images++
      }
      if (text.trim() || images) {
        items.push({ role: 'user', text: clip(text.trim()), images, ref: images ? ref : undefined, ts })
        pendingCmd = null
        said(text, ts, images)
        noteSaid(d)
      }
    } else if (Array.isArray(content)) {
      for (const part of content) {
        const reply = assistantText(part)
        if (reply) {
          items.push({ role: 'assistant', text: clip(reply), ts })
        } else if (part.type === 'tool_use') {
          const t: ChatItem = { role: 'tool', name: part.name, text: clip(toolSummary(part.name, part.input, home), 300), ts }
          tools.set(part.id, t)
          items.push(t)
        }
      }
    }
  }
  // Local commands: one "/cmd → useful output" line, without a block.
  for (const it of items) {
    if (it.role !== 'cmd') continue
    const line = usefulOutput(it.out, it.err)
    if (line) it.text = `${it.text} → ${line}`
    delete it.out
    delete it.err
  }
  // Queued task notifications: not user messages.
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
  // Script without a shell command: we name the tool called (write_stdin, apply_patch…).
  const t = s.match(/\btools\.(\w+)\s*\(/)
  if (t) return t[1]!
  return firstLine(s)
}

export function parseCodex(lines: Lines): Parsed {
  const items: Parsed = []
  const calls = new Map<string, ChatItem>()
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
      const t: ChatItem = { role: 'tool', name: p.name || 'shell', text: clip(String(summary), 300), ts }
      if (typeof p.call_id === 'string') calls.set(p.call_id, t)
      items.push(t)
    } else if ((p.type === 'function_call_output' || p.type === 'custom_tool_call_output') && Array.isArray(p.output)) {
      // Images a tool returned (view_image…), re-read on demand from this line.
      const t = calls.get(p.call_id)
      const images = p.output.filter((o: Json) => o && o.type === 'input_image').length
      if (t && images && ref) {
        t.images = images
        t.ref = ref
      }
    }
  }
  return items
}

// omp tool names mapped to Claude Code's (labels, icons).
const OMP_TOOLS: Record<string, string> = {
  bash: 'Bash', read: 'Read', write: 'Write', edit: 'Edit', ast_edit: 'Edit', grep: 'Grep',
  glob: 'Glob', find: 'Glob', web_search: 'WebSearch', fetch: 'WebFetch', task: 'Task', todo: 'TodoWrite',
}
function ompToolSummary(args: Json, home: string): string {
  const a = args && typeof args === 'object' ? args : {}
  // `i`: the intent the agent gives for each call ("Reading model settings").
  for (const k of ['i', 'title', 'description']) if (typeof a[k] === 'string' && a[k].trim()) return firstLine(a[k])
  if (typeof a.path === 'string') return home ? a.path.replace(home, '~') : a.path
  for (const k of ['command', 'pattern', 'query']) if (typeof a[k] === 'string') return firstLine(a[k])
  return firstLine(Object.values(a).find(x => typeof x === 'string') || '')
}

// omp (oh-my-pi): ~/.omp/agent/sessions/<encoded cwd>/<date>_<id>.jsonl, one
// entry per line. `message` carries a message (user, assistant, toolResult;
// developer and fileMention are agent injections); a `custom_message`
// "skill-prompt" attributed to the user is a skill they invoked.
// User messages injected by the agent (reminders, subagent
// instructions): `synthetic` or `attribution: 'agent'`. Images are
// stored separately (`data: "blob:sha256:<hash>"`, see extractImage). `templates`:
// omp's file commands, whose text it sends instead of "/name args".
export function parseOmp(lines: Lines, home = '', templates: readonly CommandTemplate[] = [], sessionCwd = ''): Parsed {
  const items: Parsed = []
  const tools = new Map<string, { item: ChatItem, name: string, at: number | null }>()
  let previousTs: string | null = null
  // Session folder (the file's first line, or `sessionCwd` for a slice
  // that does not include it): paths are shown relative to it, like omp does.
  let cwd = sessionCwd
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    const ref = lines.refs ? lines.refs[li] : undefined
    if (!line) continue
    let d: Json
    try { d = JSON.parse(line) }
    catch { continue }
    if (!d || typeof d !== 'object') continue
    const ts: string | null = typeof d.timestamp === 'string' ? d.timestamp : null
    const priorTs = previousTs
    if (ts) previousTs = ts
    if (d.type === 'session') {
      if (typeof d.cwd === 'string') cwd = d.cwd.replace(/\/+$/, '')
      continue
    }
    if (d.type === 'compaction') {
      items.push({ role: 'system', text: 'Conversation compacted', ts })
      continue
    }
    // Model switch (the selector, alt+p or /switch): shown like Claude's
    // "/model → …" line. "role": "temporary" only: a "default" change was
    // made from the provider settings panel, not from the conversation.
    if (d.type === 'model_change' && typeof d.model === 'string' && d.model && d.role === 'temporary') {
      items.push({ role: 'system', text: `/model → ${ompModelLabel(d.model)}`, ts })
      continue
    }
    if (d.type === 'custom_message') {
      const s = d.details
      if (d.customType === 'skill-prompt') {
        if (d.attribution === 'user' && s && typeof s.name === 'string') items.push({ role: 'user', text: clip(stripImageTags(`/skill:${s.name}${s.args ? ` ${s.args}` : ''}`)), ts })
      } else if (d.display && typeof d.customType === 'string') {
        // What the terminal also shows (advisor, finished background task,
        // IRC message, late diagnostics…), without the wrapper meant for the model.
        const notes: Json[] = d.customType === 'advisor' && s && Array.isArray(s.notes) ? s.notes : []
        const text = notes.length
          ? notes.filter(n => n && typeof n.note === 'string').map(n => (n.severity ? `**${n.severity}** — ${n.note}` : n.note)).join('\n\n')
          : String(d.content || '').replace(/^\s*<([\w:-]+)(?:\s[^>]*)?>\n?([\s\S]*?)\n?<\/\1>\s*$/, '$2').trim()
        if (d.customType === 'async-result' && Array.isArray(s?.jobs) && s.jobs.length) {
          for (const job of s.jobs) {
            if (typeof job.jobId !== 'string' || !/^bg_[\w-]+$/.test(job.jobId)) continue
            const header = text.match(/^Background job [^\n]+? has (completed|failed)\.[^\n]*\n?/i)
            const out = cleanOut(text.replace(header?.[0] || '', '').replace(/\n?Wall time: [\d.]+ seconds\s*$/, ''))
            items.push({ role: 'job', text: '', ts, error: header?.[1]?.toLowerCase() === 'failed',
              ms: Number.isFinite(job.durationMs) ? job.durationMs : undefined,
              job: { id: job.jobId, tool: String(job.type || 'job'), out } })
          }
        } else if (text) items.push({ role: 'notice', name: d.customType, text: clip(text), ts })
      }
      continue
    }
    if (d.type !== 'message' || !d.message) continue
    const m = d.message
    if (m.role === 'user') {
      if (m.synthetic || m.attribution === 'agent') continue
      const parts: Json[] = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : Array.isArray(m.content) ? m.content : []
      const text = ompCommandText(stripImageTags(parts.filter(p => p && p.type === 'text' && typeof p.text === 'string').map(p => p.text).join('\n')), templates)
      const images = parts.filter(p => p && p.type === 'image').length
      if (text || images) items.push({ role: 'user', text: clip(text), images, ref: images ? ref : undefined, ts })
    } else if (m.role === 'assistant') {
      for (const part of Array.isArray(m.content) ? m.content : []) {
        if (!part) continue
        if (part.type === 'thinking' && typeof part.thinking === 'string' && part.thinking.trim()) {
          const ms = ts && priorTs ? Math.max(0, Date.parse(ts) - Date.parse(priorTs)) : undefined
          items.push({ role: 'thinking', text: clip(part.thinking), ts, ms: Number.isFinite(ms) ? ms : undefined })
        } else if (part.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
          items.push({ role: 'assistant', text: clip(part.text), ts })
        } else if (part.type === 'toolCall') {
          const name = String(part.name || '').trim()
          const t: ChatItem = { role: 'tool', name: OMP_TOOLS[name] || name, text: clip(ompToolSummary(part.arguments, home), 300), ts, omp: ompToolCall(name, part.arguments, cwd, home) }
          if (part.id) tools.set(part.id, { item: t, name, at: ts ? Date.parse(ts) || null : null })
          items.push(t)
        }
      }
      if (m.stopReason === 'aborted' && /interrupt/i.test(String(m.errorMessage || ''))) items.push({ role: 'system', text: 'Interrupted', ts })
    } else if (m.role === 'bashExecution' || m.role === 'pythonExecution') {
      // "!cmd" / "$ code" typed in omp's input field: a user action, like
      // Claude's bash mode, drawn the way omp draws it.
      const v = ompUserRun(m)
      if (v) items.push({ role: 'bash', text: v.target!, ts, error: Boolean(v.exit || v.cancelled), omp: v })
    } else if (m.role === 'toolResult') {
      const t = tools.get(m.toolCallId)
      if (!t) continue
      if (m.isError) t.item.error = true
      // Images the tool returned (read of a PNG, screenshot…): re-read on
      // demand from this line, like the user's.
      const images = Array.isArray(m.content) ? m.content.filter((p: Json) => p && p.type === 'image').length : 0
      if (images && ref) {
        t.item.images = images
        t.item.ref = ref
      }
      if (t.item.omp) ompToolResult(t.item.omp, t.name, m, t.at, cwd, home)
    }
  }
  return items
}

// Text of an omp file command: "/name args". omp appends the arguments
// after the text, unless the command places them itself ($1, {{args}}…): the
// text then only starts like the command, and its arguments are lost.
function ompCommandText(text: string, templates: readonly CommandTemplate[]): string {
  for (const t of templates) {
    if (text === t.body) return `/${t.name}`
    if (text.startsWith(`${t.body}\n\n`)) return `/${t.name} ${text.slice(t.body.length + 2).trim()}`
    const head = t.body.slice(0, 160)
    if (head.length === 160 && !/[$]|\{\{/.test(head) && text.startsWith(head)) return `/${t.name}`
  }
  return text
}

// `base`: position (in bytes) of `text` in the file. Each line keeps
// its "start:length" position (lines.refs): messages with images
// carry it, to re-read the image on demand (see image()).
export function parseLines(text: string, kind: string | null, base = 0, home = '', templates?: readonly CommandTemplate[], cwd = ''): Parsed {
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
  if (kind === 'omp') return parseOmp(lines, home, templates, cwd)
  return kind === 'codex' ? parseCodex(lines) : parseClaude(lines, home)
}

// Types served as is: an SVG image (or any type written in the
// transcript) opened from wherdr would run its scripts on its origin.
const IMAGE_TYPES = /^image\/(?:png|jpeg|gif|webp)$/

// Image no. `index` of a JSON transcript line (Claude, Codex, omp). omp
// stores its images separately: `blob` is then the hash to re-read in
// ~/.omp/agent/blobs (see image()).
export type TranscriptImage = { type: string, body: Buffer } | { type: string, blob: string }
export function extractImage(d: Json, index: number): TranscriptImage | null {
  const found: ({ type: string, data: string } | { type: string, blob: string })[] = []
  const visit = (parts: Json[] | null) => {
    for (const p of parts || []) {
      if (p && p.type === 'image' && p.source && p.source.data) found.push({ type: p.source.media_type || 'image/png', data: p.source.data })
      else if (p && p.type === 'image' && typeof p.data === 'string') {
        const blob = /^blob:sha256:([a-f0-9]{64})$/.exec(p.data)
        found.push(blob ? { type: p.mimeType || 'image/png', blob: blob[1]! } : { type: p.mimeType || 'image/png', data: p.data })
      } else if (p && p.type === 'input_image') {
        const u = typeof p.image_url === 'string' ? p.image_url : p.image_url && p.image_url.url
        const mm = /^data:(image\/[\w.+-]+);base64,(.+)$/.exec(u || '')
        if (mm) found.push({ type: mm[1]!, data: mm[2]! })
      }
    }
  }
  visit(d.message && Array.isArray(d.message.content) ? d.message.content : null)
  visit(d.attachment && Array.isArray(d.attachment.prompt) ? d.attachment.prompt : null)
  visit(d.payload && Array.isArray(d.payload.content) ? d.payload.content : null)
  // Codex: images a tool returned (view_image…).
  visit(d.payload && Array.isArray(d.payload.output) ? d.payload.output : null)
  // Claude: images returned by tool results, after the message's own (see parseClaude).
  if (d.message && Array.isArray(d.message.content)) {
    for (const p of d.message.content) if (p && p.type === 'tool_result' && Array.isArray(p.content)) visit(p.content)
  }
  const img = found[index]
  if (!img) return null
  const lower = String(img.type).toLowerCase()
  const type = IMAGE_TYPES.test(lower) ? lower : 'application/octet-stream'
  return 'blob' in img ? { type, blob: img.blob } : { type, body: Buffer.from(img.data, 'base64') }
}

// `fs`: disk of the machine where the agents run (local, or remote over SSH).
// File really missing, as opposed to a failed read (SSH cut,
// timeout): only absence means "no conversation". Remotely,
// `cat`/`ls` only return their error message.
export function isMissing(e: unknown): boolean {
  const err = e as { code?: string, message?: string } | null
  if (!err) return false
  if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return true
  return err.code === 'remote' && /no such file|not a directory|introuvable/i.test(err.message || '')
}

export function createTranscripts({ home, herdr, fs = localFs }: { home: string, herdr: HerdrCall, fs?: MachineFs }) {
  const locCache = new Map<string, { at: number, loc: Loc | null, session?: string | null }>()
  const lastLoc = new Map<string, Loc>() // last file found, fallback if a lookup fails
  const parseCache = new Map<string, { size: number, r: TailResult }>()
  const metaCache = new Map<string, Json>()
  // omp file commands of this machine (see parseOmp), re-read every 5 min.
  let ompTemplates: { at: number, list: CommandTemplate[] } = { at: 0, list: [] }
  async function refreshOmpTemplates() {
    if (Date.now() - ompTemplates.at < 5 * 60 * 1000) return
    ompTemplates = { at: Date.now(), list: await ompCommandTemplates(fs, home).catch(() => ompTemplates.list) }
  }

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
    catch (e) {
      if (isMissing(e)) return false
      throw e
    }
  }
  // First existing file among `files` (a single round trip remotely).
  async function firstExisting(files: string[]) {
    if (!files.length) return null
    const st = await fs.statMany(files)
    const i = st.findIndex(s => s && s.isFile)
    return i < 0 ? null : files[i]!
  }
  async function listDir(d: string) {
    try { return await fs.readdir(d) }
    catch (e) {
      if (isMissing(e)) return []
      throw e
    }
  }

  async function locateClaude(proc: { pid: number }): Promise<Loc | null> {
    let sess: Json
    try { sess = JSON.parse(await fs.readFile(path.join(home, '.claude/sessions', `${proc.pid}.json`))) }
    catch (e) {
      if (e instanceof SyntaxError || isMissing(e)) return null
      throw e
    }
    if (!sess.sessionId) return null
    const direct = path.join(home, '.claude/projects', encodeCwd(sess.cwd || ''), `${sess.sessionId}.jsonl`)
    if (await exists(direct)) return { file: direct, session: sess.sessionId }
    // Folder encoding different from the assumed one: we look for the file.
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
    // An incomplete line (brand new file): we will retry later.
    if (meta) metaCache.set(file, meta)
    return meta
  }

  // Main Codex conversations (thread_source "user", no parent) of the
  // last three days in `cwd`.
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

  // Recent Codex (shared app-server, "managed daemon"): the session hook
  // of the Herdr integration runs in the daemon, with the environment of the first
  // Codex that started it; a new Codex's session is then reported to the
  // pane of that first Codex. So we do not trust it blindly: each Codex
  // claims the conversation created right after it appeared (`bornAt`), and a
  // reported session that is another pane's "birth" is ignored.
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

  // Codex panes of the machine (kept up to date by the state): for the claims.
  const codexPeers = new Map<string, TranscriptPane>()
  function observe(panes: TranscriptPane[]) {
    codexPeers.clear()
    for (const p of panes) if (p.agent === 'codex') codexPeers.set(p.id, p)
  }

  // File of a session known by its identifier (Herdr integration).
  const bySession = new Map<string, string>()
  async function findSessionFile(kind: string | null, id: string) {
    const known = bySession.get(id)
    if (known) {
      if (await exists(known)) return known
      bySession.delete(id)
    }
    let found: string | null = null
    if (kind === 'codex') {
      // ~/.codex/sessions/YYYY/MM/DD/rollout-<date>-<id>.jsonl, from newest to oldest.
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
    } else if (kind === 'omp') {
      // omp's Herdr integration reports the session path, not an
      // identifier: only an omp session (~/.omp/agent/sessions).
      const f = path.normalize(id)
      if (path.isAbsolute(f) && f.endsWith('.jsonl') && transcriptKind(f) === 'omp' && await exists(f)) found = f
    }
    if (found) bySession.set(id, found)
    return found
  }

  // `fresh`: a cached "no file" is not trusted (a brand new Claude writes its
  // transcript with its first message, within those 8 s).
  async function locate(pane: TranscriptPane, fresh = false): Promise<Loc | null> {
    const hit = locCache.get(pane.id)
    if (hit && (hit.loc || !fresh) && Date.now() - hit.at < 8000 && hit.session === pane.agentSession) return hit.loc
    let loc: Loc | null = null
    let failed = false
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
    } catch { failed = true }
    // Failed read (SSH, timeout): we keep the last known file rather
    // than conclude "no conversation" (the view would empty for a second).
    if (failed) {
      const last = lastLoc.get(pane.id)
      return last && (!pane.agentSession || last.session === pane.agentSession) ? last : null
    }
    locCache.set(pane.id, { at: Date.now(), loc, session: pane.agentSession })
    if (loc) lastLoc.set(pane.id, loc)
    return loc
  }

  // ------------------------------------------------------------ reading
  // Reads bytes [start, end) of the file. If `start` falls in the middle of a
  // line, it is skipped: the returned `start` is always a line start.
  async function readRange(file: string, start: number, end: number) {
    const buf = await fs.read(file, start, end - start)
    let off = 0
    if (start > 0) {
      const nl = buf.indexOf(0x0a)
      off = nl < 0 ? buf.length : nl + 1
    }
    return { start: start + off, text: buf.subarray(off).toString('utf8') }
  }

  // omp session folder, from the file's first line ("session" entry): the
  // slices read further down do not contain it.
  const ompCwds = new Map<string, string>()
  async function ompCwd(file: string): Promise<string> {
    const known = ompCwds.get(file)
    if (known !== undefined) return known
    let cwd = ''
    try {
      const d = JSON.parse((await readRange(file, 0, 4096)).text.split('\n')[0]!)
      if (d && d.type === 'session' && typeof d.cwd === 'string') cwd = d.cwd.replace(/\/+$/, '')
    } catch { /* first line longer than 4 KB or unreadable: paths stay under ~ */ }
    ompCwds.set(file, cwd)
    if (ompCwds.size > 64) ompCwds.delete(ompCwds.keys().next().value!)
    return cwd
  }

  // Goes back from `end` by windows up to PAGE_ITEMS messages (or the start).
  async function readBackwards(file: string, end: number, kind: string | null): Promise<TailResult> {
    const cwd = kind === 'omp' ? await ompCwd(file) : ''
    let start = end
    let items: ChatItem[] = []
    let queue: ClaudeQueueEntry[] | null = null
    while (start > 0 && end - start < MAX_READ_BYTES) {
      // Window widened as long as it contains no line start (a
      // multi-MB line: message with images), within the cap.
      let w = WINDOW_BYTES
      let r: { start: number, text: string }
      for (;;) {
        const s0 = Math.max(0, start - w)
        r = await readRange(file, s0, start)
        if (r.start < start || s0 === 0 || w >= MAX_READ_BYTES) break
        w *= 2
      }
      if (r.start === start) break // giant line beyond the cap: stop there
      // Each window is parsed alone (a tool result in error whose
      // call is in the previous window just loses its red mark).
      const parsed = parseLines(r.text, kind, r.start, home, ompTemplates.list, cwd)
      if (!queue) queue = parsed.queue || [] // the queue lives in the most recent window
      items = parsed.concat(items)
      start = r.start
      if (items.length >= PAGE_ITEMS) break
    }
    return { start, items, queue: queue || [] }
  }

  // Bottom of the conversation: from `from` (already shown on the phone) or,
  // on first load, the last PAGE_ITEMS messages. Cached by
  // (file, size, from).
  async function tail(file: string, kind: string | null, size: number, from: number | null): Promise<TailResult> {
    const key = `${file}|${from}`
    const c = parseCache.get(key)
    if (c && c.size === size) return c.r
    let r: TailResult
    if (from !== null && from <= size && size - from <= MAX_READ_BYTES) {
      const x = await readRange(file, from, size)
      const items = parseLines(x.text, kind, x.start, home, ompTemplates.list, kind === 'omp' ? await ompCwd(file) : '')
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
    if (!hasTranscript(pane.agent)) return { hits: [], limited: false, kind: null }
    const loc = await locate(pane)
    if (!loc || Date.now() >= deadline) return { hits: [], limited: Date.now() >= deadline, kind: null }
    // The transcript path tells the real kind (closed agent mislabeled).
    const kind = transcriptKind(loc.file) || pane.agent
    return { ...await searchFile(fs, loc.file, kind, home, query, deadline), kind }
  }

  // opts.since : token of the last state seen ("unchanged" reply if it has not moved)
  // opts.from  : re-read the bottom from this byte (continuity with older pages)
  // opts.before: load the older slice ending at this byte
  // opts.fresh : look for the file again if none was found lately (see locate)
  async function chat(pane: TranscriptPane, opts: { since?: string, from?: number | null, before?: number | null, fresh?: boolean } = {}): Promise<ChatResponse> {
    if (!hasTranscript(pane.agent)) return { available: false, reason: 'unsupported' }
    const loc = await locate(pane, Boolean(opts.fresh))
    if (!loc) return { available: false, reason: 'not_found' }
    let st
    try { st = await fs.stat(loc.file) }
    catch (e) {
      // Failed read: an error (the client keeps what it shows), not an empty result.
      if (!isMissing(e)) throw e
      locCache.delete(pane.id)
      lastLoc.delete(pane.id)
      return { available: false, reason: 'not_found' }
    }
    const fileId = path.basename(loc.file)
    const base = { available: true, file: fileId, session: loc.session, guessed: Boolean(loc.guessed) }
    if (pane.agent === 'omp') await refreshOmpTemplates()
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

  // Agent's last reply, for cards and notifications.
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
    } catch { /* no preview */ }
    return null
  }

  // Image no. `index` of the message at `ref` ("start:length"): we re-read
  // that single line and decode the image it contains (base64).
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
    const img = extractImage(d, index)
    if (!img || !('blob' in img)) return img
    const blob = path.join(home, '.omp/agent/blobs', img.blob)
    try {
      const { size } = await fs.stat(blob)
      return size > 60 * 1024 * 1024 ? null : { type: img.type, body: await fs.read(blob, 0, size) }
    } catch { return null }
  }

  // Last model written in the transcript. Backward reading by windows
  // (up to MODEL_MAX_BYTES), then only the part added since. omp writes its
  // model and its thinking level in separate entries: each is the latest of
  // its kind, so the reading goes on until both are found (`raw`: partial).
  const MODEL_WINDOW = 512 * 1024
  const MODEL_MAX_BYTES = 16 * 1024 * 1024
  const modelCache = new Map<string, { file: string, size: number, raw: ModelInfo | null, info: ModelInfo | null }>()
  async function model(pane: TranscriptPane): Promise<ModelInfo | null> {
    if (!pane.agent || !['claude', 'codex', 'omp'].includes(pane.agent)) return null
    const loc = await locate(pane)
    if (!loc) return null
    // A failed read (SSH dropped, timeout) says nothing about the model: keep
    // the last value of this file, or let the caller keep its own. Only a
    // missing file means "no model".
    const stale = (e: unknown) => {
      if (c && c.file === loc.file) return c.info
      if (isMissing(e)) return null
      throw e
    }
    const c = modelCache.get(pane.id)
    let size: number
    try { size = (await fs.stat(loc.file)).size }
    catch (e) { return stale(e) }
    if (c && c.file === loc.file && c.size === size) return c.info
    const omp = pane.agent === 'omp'
    let raw: ModelInfo | null = null
    let done = size // end of the last complete line (a line being written will be re-read)
    try {
      // Already read up to c.size: only what follows can bring something new. We
      // start from the byte before (the newline): readRange skips the line
      // started at the beginning of the window.
      const floor = c && c.file === loc.file && c.size < size ? c.size : 0
      let end = size
      let w = MODEL_WINDOW
      while (end > floor && size - end < MODEL_MAX_BYTES) {
        const s0 = Math.max(floor ? floor - 1 : 0, end - w)
        const r = await readRange(loc.file, s0, end)
        if (r.start >= end) {
          // No whole line in the window (message with images): we widen it.
          if (s0 <= Math.max(0, floor - 1) || w >= MODEL_MAX_BYTES) break
          w *= 2
          continue
        }
        if (end === size && !r.text.endsWith('\n')) done = size - Buffer.byteLength(r.text.slice(r.text.lastIndexOf('\n') + 1))
        const lines = r.text.split('\n').map(stripBlobs)
        raw = omp ? mergeOmpModel(raw, ompLastModel(lines)) : lastModel(lines, pane.agent)
        if (omp ? ompModelComplete(raw) : raw) break
        end = r.start
      }
      if (floor && c) raw = omp ? mergeOmpModel(raw, c.raw) : raw || c.raw
    } catch (e) { return stale(e) }
    const info = omp ? ompModelResult(raw) : raw
    modelCache.set(pane.id, { file: loc.file, size: done, raw, info })
    return info
  }

  // Tool call waiting for a permission: the last one without a result, read
  // from the end of the transcript (re-read only if the file has grown).
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

  // omp: the "ask" call still unanswered (see pendingOmpAsk).
  const askCache = new Map<string, { file: string, size: number, asked: OmpAsked[] }>()
  async function pendingAsk(pane: TranscriptPane): Promise<OmpAsked[]> {
    if (pane.agent !== 'omp') return []
    const loc = await locate(pane)
    if (!loc) return []
    let size: number
    try { size = (await fs.stat(loc.file)).size }
    catch { return [] }
    const c = askCache.get(pane.id)
    if (c && c.file === loc.file && c.size === size) return c.asked
    let asked: OmpAsked[] = []
    try { asked = pendingOmpAsk((await readRange(loc.file, Math.max(0, size - PENDING_WINDOW), size)).text.split('\n').map(stripBlobs)) }
    catch { asked = [] }
    askCache.set(pane.id, { file: loc.file, size, asked })
    return asked
  }

  // Claude: the AskUserQuestion call still unanswered (see pendingClaudeAsk).
  const claudeAskCache = new Map<string, { file: string, size: number, asked: ClaudeAsked[] }>()
  async function pendingClaudeQuestions(pane: TranscriptPane): Promise<ClaudeAsked[]> {
    if (pane.agent !== 'claude') return []
    const loc = await locate(pane)
    if (!loc) return []
    let size: number
    try { size = (await fs.stat(loc.file)).size }
    catch { return [] }
    const c = claudeAskCache.get(pane.id)
    if (c && c.file === loc.file && c.size === size) return c.asked
    let asked: ClaudeAsked[] = []
    try { asked = pendingClaudeAsk((await readRange(loc.file, Math.max(0, size - PENDING_WINDOW), size)).text.split('\n').map(stripBlobs)) }
    catch { asked = [] }
    claudeAskCache.set(pane.id, { file: loc.file, size, asked })
    return asked
  }

  function forget(paneId: string) {
    locCache.delete(paneId)
    lastLoc.delete(paneId)
    modelCache.delete(paneId)
    pendingCache.delete(paneId)
    askCache.delete(paneId)
    claudeAskCache.delete(paneId)
  }

  return { chat, preview, image, forget, locate, model, observe, search, pendingTool, pendingAsk, pendingClaudeQuestions }
}

export type Transcripts = ReturnType<typeof createTranscripts>
