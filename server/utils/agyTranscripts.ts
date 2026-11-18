// Antigravity CLI (`agy`) conversations: ~/.gemini/antigravity-cli/conversations/
// <uuid>.db (SQLite, WAL mode, protobuf step payloads). The pure half lives
// here: wire blobs in (agyProtobuf.ts), steps, chat items and page anchors out.
import { createHash } from 'node:crypto'
import path from 'node:path'
import type { ChatItem, ModelInfo } from '../../shared/types'
import { clip } from './transcriptText'
import { ompModelLabel } from './models'
import { fieldOf, isoOf, subOf, textOf, tsOf, wireFields, type WireField } from './agyProtobuf'

const hash12 = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 12)
const HEAD = /^(.*):(\d+):(null|\d+):([0-9a-f]{12})(?=[/~#]|$)/
const ANCHOR = /\/(\d+)\.([0-9a-f]{12})(?=[~#]|$)/
const AGY_SESSION = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i

// step_type values seen in conversations/<id>.db.
const USER_INPUT = 14
const PLANNER_RESPONSE = 15
const ERROR_MESSAGE = 17
const OBSERVATION = 132

export function agyCliDir(home: string, honorEnv = true): string {
  if (honorEnv) {
    const dir = process.env.ANTIGRAVITY_APP_DATA_DIR
    if (dir) return dir
  }
  return path.join(home, '.gemini', 'antigravity-cli')
}

export function conversationPath(home: string, session: string, honorEnv = true): string | null {
  if (!session || !AGY_SESSION.test(session)) return null
  return path.join(agyCliDir(home, honorEnv), 'conversations', `${session}.db`)
}

// ------------------------------------------------------------ protobuf decode
// The `steps` row's `metadata` column and `step_payload` field 5 carry the same
// message: { 1: Timestamp created, 3: source, 4: tool call reference on
// observations, 6/7/8: start/end Timestamps, 9: generation info, 12: step uuid,
// 20: { trajectory, index, cascade } }.
interface StepMeta {
  ts: string | null
  startMs: number | null
  endMs: number | null
  callId: string | null
  callName: string | null
  callArgs: string | null
}

function stepMeta(buf: Uint8Array | null | undefined, payload: Uint8Array | null | undefined): StepMeta {
  const fs = wireFields(buf && buf.length ? buf : fieldOf(payload, 5)?.buf)
  const ts = isoOf(fs.find(f => f.tag === 1))
  const start = tsOf(fs.find(f => f.tag === 6))
  const end = tsOf(fs.find(f => f.tag === 8)) ?? tsOf(fs.find(f => f.tag === 7))
  const call = subOf(fs.find(f => f.tag === 4))
  return {
    ts, startMs: start, endMs: end,
    callId: textOf(call.find(f => f.tag === 1)) || null,
    callName: textOf(call.find(f => f.tag === 2)) || null,
    callArgs: textOf(call.find(f => f.tag === 3)) || null,
  }
}

// A user prompt may arrive wrapped in <USER_REQUEST>…</USER_REQUEST>, followed
// by machine context blocks that are not part of what was typed.
const USER_REQUEST = /^\s*<USER_REQUEST>\n?([\s\S]*?)\n?<\/USER_REQUEST>/
const USER_CONTEXT = /\n\s*<(?:user|system|workspace|context|environment)[a-z_-]*[\s>][\s\S]*$/i
export function agyUserText(f19: WireField | undefined): string {
  let text = textOf(subOf(f19).find(f => f.tag === 2)) || textOf(subOf(subOf(f19).find(f => f.tag === 3)).find(f => f.tag === 1))
  const wrapped = USER_REQUEST.exec(text)
  if (wrapped) text = wrapped[1]!
  return clip(text.replace(USER_CONTEXT, '').trim())
}

interface AgyCall { id: string, name: string, args: string }
export interface AgyStep {
  idx: number
  role: 'user' | 'agent' | 'obs' | 'error' | 'hidden'
  ts: string | null
  ms: number | undefined
  text: string
  thinking: string
  calls: AgyCall[]
  resultOf: string | null
  out: string
  error: boolean
}

// step_payload.140: { 1: { key, value } summary entries (repeated),
// 2: { 1: result text, 3: display, 6: details, 7: artifact link } }.
function observationOut(payload: Uint8Array | null | undefined): string {
  const f2 = subOf(fieldOf(payload, 140)).find(f => f.tag === 2)
  return clip(textOf(subOf(f2).find(f => f.tag === 1)))
}

function errorText(payload: Uint8Array | null | undefined, details: Uint8Array | null | undefined): string {
  const f3 = subOf(fieldOf(payload, 24)).find(f => f.tag === 3)
  const own = subOf(f3)
  const text = textOf(own.find(f => f.tag === 2)) || textOf(own.find(f => f.tag === 1))
    || (details ? new TextDecoder('utf-8', { fatal: false }).decode(details) : '')
  return clip(text)
}

export function agyToolSummary(name: string, argsJson: string): string {
  let args: Record<string, unknown> = {}
  try { const a = JSON.parse(argsJson || ''); if (a && typeof a === 'object' && !Array.isArray(a)) args = a } catch { /* unparsed arguments: the name still labels the call */ }
  const first = (...keys: string[]) => keys.map(k => args[k]).find(v => typeof v === 'string' && v.trim()) as string | undefined
  const text = first('CommandLine', 'Path', 'FilePath', 'Query', 'Url', 'Pattern', 'DirPath', 'Description', 'Prompt', 'Question', 'TaskId')
    || Object.values(args).find((v): v is string => typeof v === 'string' && Boolean(v.trim())) || name
  return clip(String(text).split('\n').find(l => l.trim()) || name)
}

export function parseAgyStep(idx: number, type: number, status: number, meta: Uint8Array | null | undefined, payload: Uint8Array | null | undefined, details: Uint8Array | null | undefined): AgyStep | null {
  const m = stepMeta(meta, payload)
  const ms = m.startMs !== null && m.endMs !== null && m.endMs >= m.startMs ? Math.round(m.endMs - m.startMs) : undefined
  const failed = status === 6 || status === 7 || Boolean(details && details.length)
  if (type === USER_INPUT) {
    const text = agyUserText(fieldOf(payload, 19))
    return text ? { idx, role: 'user', ts: m.ts, ms: undefined, text, thinking: '', calls: [], resultOf: null, out: '', error: false } : null
  }
  if (type === PLANNER_RESPONSE) {
    const f20 = subOf(fieldOf(payload, 20))
    const thinking = clip(textOf(f20.find(f => f.tag === 3)))
    // 1 is the reply shown in the terminal; 8 repeats it (signed copy).
    const text = clip(textOf(f20.find(f => f.tag === 1)) || textOf(f20.find(f => f.tag === 8)))
    const calls: AgyCall[] = []
    for (const c of f20.filter(f => f.tag === 7)) {
      const fs = subOf(c)
      const id = textOf(fs.find(f => f.tag === 1))
      if (id) calls.push({ id, name: textOf(fs.find(f => f.tag === 2)) || 'Tool', args: textOf(fs.find(f => f.tag === 3)) })
    }
    if (!thinking && !text && !calls.length) return null
    return { idx, role: 'agent', ts: m.ts, ms, text, thinking, calls, resultOf: null, out: '', error: failed }
  }
  if (type === OBSERVATION) {
    const out = observationOut(payload)
    return { idx, role: 'obs', ts: m.ts, ms, text: '', thinking: '', calls: [], resultOf: m.callId, out, error: failed }
  }
  if (type === ERROR_MESSAGE) {
    const text = errorText(payload, details)
    return text ? { idx, role: 'error', ts: m.ts, ms: undefined, text, thinking: '', calls: [], resultOf: null, out: '', error: true } : null
  }
  // CHECKPOINT compaction and SYSTEM_MESSAGE injections are internal context
  // the terminal never renders: they produce no item.
  return { idx, role: 'hidden', ts: m.ts, ms: undefined, text: '', thinking: '', calls: [], resultOf: null, out: '', error: false }
}

export interface AgyDoc {
  file: string
  model: ModelInfo | null
  steps: AgyStep[]
  fingerprints: Map<number, string>
  results: Map<string, { out: string, error: boolean }>
}

export function parseAgy(kept: AgyStep[], doc: AgyDoc): ChatItem[] {
  const items: ChatItem[] = []
  for (const s of kept) {
    const ref = (slot: string) => `${s.idx}:${slot}`
    if (s.role === 'user') { items.push({ role: 'user', text: s.text, ts: s.ts, ref: ref('u') }); continue }
    if (s.role === 'agent') {
      if (s.thinking) items.push({ role: 'thinking', text: s.thinking, ts: s.ts, ref: ref('h'), ...(s.ms !== undefined ? { ms: s.ms } : {}) })
      if (s.text) items.push({ role: 'assistant', text: s.text, ts: s.ts, ref: ref('a') })
      for (const [n, call] of s.calls.entries()) {
        const hit = call.id ? doc.results.get(call.id) : undefined
        items.push({
          role: 'tool', name: call.name, text: agyToolSummary(call.name, call.args), ts: s.ts, ref: ref(`t${n}`),
          ...(hit?.out ? { out: hit.out } : {}),
          ...(hit?.error ? { error: true } : {}),
        })
      }
      continue
    }
    if (s.role === 'error') items.push({ role: 'notice', name: 'error', text: s.text, ts: s.ts, ref: ref('e'), error: true })
  }
  return items
}

// Latest generation metadata: `data` field 1 holds { 19: model id,
// 21: display name }; field 3's 28 repeats the session's model id.
export function modelOf(data: Uint8Array | null | undefined): ModelInfo | null {
  const f1 = [...wireFields(data)].filter(f => f.tag === 1).pop()
  const fs = f1 ? subOf(f1) : []
  const id = textOf(fs.find(f => f.tag === 19)) || textOf(subOf(fieldOf(data, 3)).find(f => f.tag === 28))
  if (!id) return null
  return { id, label: textOf(fs.find(f => f.tag === 21)) || ompModelLabel(id) }
}

export function takeVisible(steps: AgyStep[], doc: AgyDoc, limit: number): { steps: AgyStep[], start: number, items: ChatItem[] } {
  const kept: AgyStep[] = []
  let visible = 0
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i]!
    kept.push(step)
    visible += parseAgy([step], doc).length
    if (visible >= limit) break
  }
  kept.reverse()
  const items = parseAgy(kept, doc)
  const start = kept.length < steps.length ? kept[0]?.idx ?? 0 : 0
  return { steps: kept, start, items }
}

export function prefixOf(doc: AgyDoc, start: number): string {
  return hash12(doc.steps.filter(s => s.idx < start).map(s => `${s.idx}.${doc.fingerprints.get(s.idx)}`).join('|'))
}

export function agyHeadOf(token: string | null | undefined) {
  const m = HEAD.exec(String(token || ''))
  return m ? { file: m[1]!, size: Number(m[2]), from: m[3] === 'null' ? null : Number(m[3]), gen: m[4]! } : null
}

export function agyAnchorOf(token: string | null | undefined) {
  const m = ANCHOR.exec(String(token || ''))
  return m ? { start: Number(m[1]), hash: m[2]! } : null
}

export function hasStep(steps: AgyStep[], idx: number): boolean {
  return idx === 0 || steps.some(s => s.idx === idx)
}
