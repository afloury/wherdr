// The user acts on a task outside its coordinators' conversations: answers the
// task's agent in its own session (the conversation, raw input or the terminal
// stream), or presses a step's button. Nobody else would learn it,
// so it is told:
// - the task's log line and `Task.replied` (the review entry: "You replied to the agent at 14:05"),
// - a wake of the task's own coordinator at once (kind 'reply', about the task, replies within a minute
//   batched; never for the coordinator's own tell, which is not a message of the user's), and again with
//   the agent's answer when it next reports (answerWake),
// - an `Elsewhere` entry on the task's coordinator and on Alfred (shared/pm/elsewhere.ts): Alfred says it in
//   its next wake (pmWakes.ts), and an open card of theirs about the task reads as answered.
// Nothing here moves a task's step, guards or state, or its agent's labels.
import { randomUUID } from 'node:crypto'
import { MAIN } from '../../shared/pm/coordinator'
import { noticeText, recordElsewhere, repliedOpen, repliedSeen, type Elsewhere, type ElsewhereWhat } from '../../shared/pm/elsewhere'
import { showIds } from '../../shared/pm/projectKey'
import { coordinatorKey } from '../../shared/pm/workspace'
import { enqueue, replyAfter, type Wake } from '../../shared/pm/wakes'
import type { Task } from '../../shared/pm/run'
import type { PmStore } from './pmStore'

export const SAID_CHARS = 80, WAKE_CHARS = 120, ANSWER_CHARS = 400
// The first words of what the user said, on one line.
export const saidOf = (text: string) => {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > SAID_CHARS ? `${one.slice(0, SAID_CHARS - 1).trimEnd()}…` : one
}

// The entry on every coordinator that should learn of it: the task's own (when it has a record) and Alfred.
// `woken`: the task's own coordinator is woken by it (a reply), so its next wake need not say it again.
async function tellCoordinators(store: PmStore, task: { id: string, project: string }, e: Omit<Elsewhere, 'task' | 'shown'>, now: number, woken = false) {
  const projects = await store.projects()
  const own = coordinatorKey(task.project, projects)
  for (const key of new Set([own, MAIN])) {
    const c = await store.coordinator(key)
    const entry: Elsewhere = { task: task.id, shown: showIds(projects, task.id), ...e, ...(woken && key === own && c?.terminal ? { woken: true as const } : {}) }
    if (c) await store.saveCoordinator({ ...c, elsewhere: recordElsewhere(c.elsewhere ?? [], entry, now) })
  }
}

const newId = () => randomUUID().replace(/-/g, '').slice(0, 8)
const oneLine = (s: string, max: number) => { const one = s.replace(/\s+/g, ' ').trim(); return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one }

// Wakes the task's coordinator (when it runs) with `reason`: joins its pending reply wake for the task,
// whose delivery waits for more replies (replyAfter).
async function wakeReply(store: PmStore, task: { id: string, project: string }, reason: string, now: number) {
  const projects = await store.projects(), key = coordinatorKey(task.project, projects)
  if (!(await store.coordinator(key))?.terminal) return
  const w: Wake = enqueue(await store.wakes(), key, [reason], now, newId(), false, { kind: 'reply', about: `${task.id} (reply)` })
  await store.saveWakes([{ ...w, after: replyAfter(w.createdAt, now) }])
}

// What the agent said after the user's reply: its question, else its last report, else its verdict.
export function answerOf(t: Pick<Task, 'question' | 'workReports'> & { replied?: { seen?: { reports: number } } }): string {
  const reports = t.workReports ?? []
  if (t.question) return oneLine(t.question, ANSWER_CHARS)
  const was = t.replied?.seen?.reports ?? 0
  return reports.length > was ? oneLine(reports.at(-1)!.text, ANSWER_CHARS) : 'it gave its verdict (see the task)'
}

// The agent has reported, asked or ruled since the user's reply: the coordinator hears its answer, once.
export async function answerWake(store: PmStore, t: Task, now: number) {
  const r = t.replied
  if (!r || r.told || repliedOpen(t) || now - r.at > 6 * 3_600_000) return
  const saved = await store.updateTask(t.id, c => (c.replied && !c.replied.told && c.replied.at === r.at ? { ...c, replied: { ...c.replied, told: true as const } } : null))
  if (saved) await wakeReply(store, t, `${t.id}'s ${r.role} answered: ${answerOf(t)}`, now)
}

// The user's message to the agent in `terminal`: the run of a task (worker or reviewer, not ended) only.
// Returns whether it was logged.
export async function userRepliedTo(store: PmStore, terminal: string | undefined, text: string, now = Date.now()): Promise<boolean> {
  const said = saidOf(text)
  if (!terminal || !said || !(await store.enabled())) return false
  const run = (await store.runs()).find(r => r.terminal === terminal && r.state !== 'ended' && (r.role === 'worker' || r.role === 'reviewer'))
  if (!run) return false
  const task = await store.updateTask(run.task, t => ({ ...t, replied: { at: now, role: run.role, said, seen: repliedSeen(t) } }), { by: 'user', text: `you replied to the ${run.role}: ${said}` })
  if (!task) return false
  await tellCoordinators(store, task, { at: now, what: 'reply', role: run.role, said }, now, true)
  await wakeReply(store, task, `You replied to ${task.id}'s ${run.role} at ${hhmm(now)}: ${oneLine(text, WAKE_CHARS)}`, now)
  return true
}

// The user pressed a step's button.
export async function userActedOn(store: PmStore, id: string, what: Exclude<ElsewhereWhat, 'reply'>, now = Date.now()) {
  const task = await store.task(id)
  if (task) await tellCoordinators(store, task, { at: now, what }, now)
}

const pad = (n: number) => String(n).padStart(2, '0')
export const hhmm = (at: number) => { const d = new Date(at); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }

const NOTICES = 10
// What a wake tells of the entries it has not told yet (newer than `told`), one line each.
export function noticeLines(list: readonly Elsewhere[] | undefined, told = 0): string[] {
  const fresh = (list ?? []).filter(e => e.at > told && !e.woken)
  return [...fresh.slice(0, NOTICES).map(e => noticeText(e, hhmm(e.at))), ...(fresh.length > NOTICES ? [`and ${fresh.length - NOTICES} more actions of the user on tasks, outside your conversation`] : [])]
}

// ---- the terminal stream: raw keystrokes into submitted lines ----

const PASTE_ON = '\x1b[200~', PASTE_OFF = '\x1b[201~'
const ESC = /\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1bO.|\x1b[\s\S]?/y
const BUFFER_MAX = 4000

// Typed text since the last line, and the lines Enter submitted: `data` as the terminal got it.
// Escape sequences (arrows, mouse, focus) are dropped; Backspace and Ctrl-U/C edit the line;
// a bracketed paste's line breaks stay in the line.
export function typed(buf: string, data: string): { buf: string, lines: string[] } {
  const lines: string[] = []
  let line = buf, paste = false
  for (let i = 0; i < data.length;) {
    if (data.startsWith(PASTE_ON, i)) { paste = true; i += PASTE_ON.length; continue }
    if (data.startsWith(PASTE_OFF, i)) { paste = false; i += PASTE_OFF.length; continue }
    const ch = data[i]!
    if (ch === '\x1b') { ESC.lastIndex = i; const m = ESC.exec(data); i += m ? m[0].length : 1; continue }
    i++
    if ((ch === '\r' || ch === '\n') && !paste) { if (line.trim()) lines.push(line); line = '' }
    else if (ch === '\r' || ch === '\n') line += ' '
    else if (ch === '\x7f' || ch === '\b') line = [...line].slice(0, -1).join('')
    else if (ch === '\x15' || ch === '\x03' || ch === '\x04') line = ''
    else if (ch === '\t' || ch >= ' ') line += ch
  }
  return { buf: line.length > BUFFER_MAX ? line.slice(-BUFFER_MAX) : line, lines }
}

// The input a terminal.input / paste frame of the browser carries (text, or base64 bytes), and
// the keys frame's: Enter submits, Backspace edits. undefined: not an input frame.
export function frameInput(raw: string): string | undefined {
  let m: { type?: unknown, text?: unknown, bytes?: unknown, keys?: unknown }
  try { m = JSON.parse(raw) } catch { return undefined }
  if (m?.type === 'terminal.input' || m?.type === 'paste') {
    if (typeof m.text === 'string') return m.text
    if (typeof m.bytes === 'string') return Buffer.from(m.bytes, 'base64').toString('utf8')
  }
  if (m?.type === 'keys' && Array.isArray(m.keys)) return m.keys.map(k => (k === 'enter' || k === 'Enter' ? '\r' : k === 'backspace' || k === 'BSpace' ? '\x7f' : '')).join('')
  return undefined
}
