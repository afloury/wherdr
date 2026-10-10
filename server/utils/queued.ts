// Messages sent from the phone and shown as "queued": when
// did the agent take them?
import type { ChatItem, QueuedMessage } from '../../shared/types'
import { isUploadLine, photosLanded, photosOnly } from '../../shared/queuedMatch'

export const QUEUED_TTL_MS = 60 * 60 * 1000
// Sent photo ("<home>/.cache/herdr-web/uploads/<name>" line of a message).
export { isUploadLine }
const norm = (t: unknown) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase()
// "! cmd": Claude Code switches to bash mode and only writes "cmd" (<bash-input>).
// omp also has "!!cmd" (kept out of the model's context) and "$ code" / "$$ code" (Python).
export const bashText = (t: string) => String(t || '').replace(/^\s*(?:!!?|\$\$?)\s*/, '')
// omp runs "!cmd" / "!!cmd" / "$ code" / "$$ code" the moment it is submitted,
// even during a turn. A run that ends while the agent works is only written
// to the transcript when the next prompt starts: once that turn is over, the
// run is taken even though the transcript does not show it yet.
export const isOmpRun = (agent: string | null | undefined, text: string) => agent === 'omp' && /^\s*(?:!|\$\$?\s)/.test(String(text || ''))
// The run omp shows on screen ("Running…", see parseOmpShell) is this message's
// command: omp took it. A run cancelled (Stop, Escape) or finished while omp
// rests may never reach the transcript (omp 18.6 writes none before the first
// prompt of a session, and only "You ran" blocks with the next prompt).
export function ompRunShown(agent: string | null | undefined, text: string, shell: { command: string, python?: boolean } | null | undefined): boolean {
  if (!shell || !isOmpRun(agent, text) || /^\s*\$/.test(text) !== Boolean(shell.python)) return false
  // Without spaces: the screen wraps a long command, even mid-word, and may cut it.
  const want = bashText(text).replace(/\s+/g, '').toLowerCase().slice(0, 80)
  const shown = String(shell.command || '').replace(/\s+/g, '').toLowerCase().slice(0, 80)
  return Boolean(want && shown) && (shown.startsWith(want) || (shown.length >= 8 && want.startsWith(shown)))
}

// Taken by the agent = a user message in the transcript, written after
// sending, that contains the start of the text (Claude may group several
// queued messages into a single turn). Text modified by the agent: when idle,
// a user message written after sending followed by a reply is enough.
export function queuedDone(q: { text: string, at: number, turnSeen?: boolean }, items: ChatItem[], idle: boolean, now: number, agent?: string | null): boolean {
  if (now - q.at > QUEUED_TTL_MS) return true
  if (idle && q.turnSeen && isOmpRun(agent, q.text)) return true
  const users = items.filter(i => i.role === 'user' || i.role === 'cmd' || i.role === 'bash')
  // Photo paths become images in the transcript; photos alone are matched by
  // their photos (see shared/queuedMatch.ts).
  const needle = norm(q.text.split('\n').filter(l => !isUploadLine(l)).join(' ')).slice(0, 80)
  const bashNeedle = norm(bashText(q.text)).slice(0, 80)
  const photos = photosOnly(q.text)
  if (users.some(u => (!u.ts || Date.parse(u.ts) >= q.at - 10000)
    && (u.role === 'bash' ? Boolean(bashNeedle) && norm(u.text).includes(bashNeedle)
      : needle ? norm(u.text).includes(needle) : photos ? photosLanded(q.text, u) : (u.images || 0) > 0))) return true
  if (!idle) return false
  const i = items.findIndex(u => u.role === 'user' && u.ts && Date.parse(u.ts) > q.at)
  return i >= 0 && items.slice(i + 1).some(a => a.role === 'assistant')
}

// Messages sent while a menu, panel or dialog hides the agent's input field (an
// interactive /mcp, /hooks… flow, omp's tool approval): typed into it, they
// would be lost, or Enter would answer it. They are held here and delivered,
// in order, as soon as the input is visible again.
// A message that was delivered but never shows up in the transcript while the
// agent sits ready is reported as failed, with Retry / Cancel, instead of
// staying "sending…" forever.
export const HOLD_TTL_MS = 10 * 60 * 1000
// Held because the agent's input field holds someone else's text (see
// guardedSend.ts): reported as not sent sooner, the field may stay so.
export const BUSY_TTL_MS = 2 * 60 * 1000
export const LOST_MS = 60 * 1000
// Held while the agent is ready and no menu, question or panel is recognized
// on its screen: nothing will close, the input field is just not found
// (unknown screen). Reported as not sent, with that reason, instead of
// waiting "until the menu closes" for nothing.
export const NO_INPUT_MS = 30 * 1000
export const HOLD_AGENTS = new Set(['claude', 'codex', 'omp'])
// Agent at rest, whose input field may be checked on screen (see closePanel).
export const INPUT_STATES = new Set(['idle', 'done', 'unknown'])

export interface QueueEntry {
  id: string
  text: string
  at: number
  held?: boolean
  failed?: boolean
  // Held (or failed) because the agent's input field was not empty.
  busy?: boolean
  // Since when the agent has been ready with this message delivered.
  readySince?: number
  // The agent worked (a turn) after this message was typed (see isOmpRun).
  turnSeen?: boolean
  // Held: since when the agent has been ready with no menu recognized.
  stuckSince?: number
  // Failed because the input field was not found on an unknown screen.
  noInput?: boolean
}

// Hold a new message instead of typing it now?
export function shouldHold(agent: string | null | undefined, status: string | null | undefined, input: boolean, earlierHeld: boolean): boolean {
  if (!agent || !HOLD_AGENTS.has(agent)) return false
  // Keep the order: behind a held message, everything waits.
  if (earlierHeld) return true
  return INPUT_STATES.has(status || '') && !input
}

// Next held message to deliver: the oldest one, and only when nothing older
// is still held (a failed one is skipped: it waits for Retry or Cancel).
export function nextHeld(list: QueueEntry[]): QueueEntry | null {
  return list.find(q => q.held && !q.failed) || null
}

// Updates timers in place on each poll; true when an entry just failed.
// `menu`: a menu, question or panel recognized on the agent's screen (or a
// restart running): something a held message legitimately waits for.
export function checkQueue(list: QueueEntry[], status: string | null | undefined, now: number, menu = true): boolean {
  let changed = false
  const ready = status === 'idle' || status === 'done'
  for (const q of list) {
    if (q.failed) continue
    if (q.held) {
      if (now - q.at > (q.busy ? BUSY_TTL_MS : HOLD_TTL_MS)) { q.failed = true; changed = true; continue }
      if (q.busy || !ready || menu) { delete q.stuckSince; continue }
      q.stuckSince ??= now
      if (now - q.stuckSince > NO_INPUT_MS) { q.failed = true; q.noInput = true; changed = true }
      continue
    }
    if (!ready) { delete q.readySince; continue }
    q.readySince ??= now
    if (now - Math.max(q.readySince, q.at) > LOST_MS) { q.failed = true; changed = true }
  }
  return changed
}

// Held messages nobody will take any more: not sent, with Retry / Cancel.
export function failHeld(list: QueueEntry[] | undefined) {
  for (const q of list || []) if (q.held) q.failed = true
}

// Fields the app sees.
export const publicEntry = (q: QueueEntry): QueuedMessage => ({
  id: q.id, text: q.text, at: q.at,
  ...(q.held && !q.failed ? { state: 'held' as const } : {}),
  ...(q.failed ? { state: 'failed' as const } : {}),
  ...((q.held || q.failed) && q.busy ? { reason: 'busy' as const } : q.failed && q.noInput ? { reason: 'no_input' as const } : {}),
})

// Records read back from data/queued.json at startup: well-formed, recent
// ones only (a delivery interrupted by the restart is held again).
export function loadQueued(raw: unknown, now: number): [string, QueueEntry[]][] {
  if (!raw || typeof raw !== 'object') return []
  const out: [string, QueueEntry[]][] = []
  for (const [pane, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue
    const ok = list.filter((q): q is QueueEntry => Boolean(q) && typeof q.id === 'string' && typeof q.text === 'string' && typeof q.at === 'number'
      && now - q.at < QUEUED_TTL_MS)
      .map(q => ({ id: q.id, text: q.text, at: q.at, ...(q.held ? { held: true } : {}), ...(q.failed ? { failed: true } : {}), ...(q.busy ? { busy: true } : {}) }))
    if (ok.length) out.push([pane, ok])
  }
  return out
}
