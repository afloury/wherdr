// Sending a message to Claude Code without gluing it to another writer's.
//
// Several writers type into the same input field: wherdr, and tools such as
// the herdr-projects ticker (`herdr agent prompt "[hp inbox] …"`). Herdr
// serializes its own `agent.prompt` calls per pane, but only until the Enter
// key is written: a Claude Code that lags (busy Pi, long session) may take
// that Enter after the next writer's text has arrived, and submits both as one
// message ("…confondu) ?[hp inbox] t-0171 new report", seen on Herdr 0.9.1 /
// Claude Code 2.1.x). `agent.prompt` also appends to any text already in the
// field. Herdr's `wait` option does not extend its lock either.
//
// So wherdr types the message itself and checks the field (read from the
// screen) at every step:
// - before typing, the field must be empty. Text already there (a draft typed
//   in the terminal, another writer's message on its way) is never cleared:
//   after a short wait the send is refused with `input_busy` and the caller
//   holds the message until the field is free;
// - after typing and before Enter, the field must hold exactly our text.
//   Text that appeared before or after it meanwhile is another writer's: the
//   field is cleared, our text typed again, and that foreign text is kept and
//   typed back as its own message right after ours (its writer already
//   believes it sent it, nobody else would);
// - after Enter, the field must empty (Claude took the message). Still our
//   text alone: Enter is pressed once more. Our text with foreign text: our
//   Enter was lost, same repair as above.
// Text the field shows in a way we cannot split exactly (a foreign paste
// shown as "[Pasted text #2]"…) is never cleared: sent as it is, logged.
import { HerdrError } from './herdr'
import { clearKeys } from './unqueue'

export interface GuardDeps {
  // Content of the input field ('' empty), null when it is not on screen.
  box: () => Promise<string | null>
  type: (text: string) => Promise<void>
  keys: (keys: string[]) => Promise<void>
  sleep: (ms: number) => Promise<void>
  // User messages the agent recorded since `since` (ms), from its transcript:
  // tells whether another writer's Enter already submitted the field.
  sentSince?: (since: number) => Promise<string[]>
  now?: () => number
  log?: (msg: string) => void
}

export interface GuardOptions {
  // Wait for an occupied field to empty before refusing (ms).
  freeWaitMs?: number
  // How long the field must stay empty before we type (ms).
  quietMs?: number
  // Wait for the typed text to show (ms).
  showWaitMs?: number
  // Wait for the field to empty after Enter (ms).
  submitWaitMs?: number
  pollMs?: number
}

export interface GuardResult {
  // Foreign texts taken out of our message and typed back after it.
  foreign: string[]
  // Foreign texts that could not be typed back (field busy): the caller must
  // keep them (wherdr holds them like its own messages).
  unsent: string[]
}

const DEFAULTS: Required<GuardOptions> = { freeWaitMs: 2000, quietMs: 400, showWaitMs: 4000, submitWaitMs: 4000, pollMs: 50 }
// Time for the transcript to record a message just submitted (ms).
const RECORD_MS = 600
const MAX_ATTEMPTS = 3
const MAX_FOREIGN = 5

// Stand-ins Claude Code shows instead of a long paste or an image.
const PLACEHOLDER = /\[(?:Pasted text|Image) #\d+[^\]]*\]/g
const PASTE_ONLY = /^\[Pasted text #\d+[^\]]*\]$/
const compact = (s: string) => s.replace(/\s+/g, '')
const tidy = (s: string) => s.replace(/\s+/g, ' ').trim()

export type BoxState =
  | { kind: 'empty' }
  | { kind: 'exact' }
  | { kind: 'partial' } // our text, still being drawn
  | { kind: 'glued', foreign: string[] } // our text with someone else's
  | { kind: 'unknown' } // cannot be split exactly

// What the field holds, compared with the text we typed. Wrapping changes
// the spaces and line breaks the screen shows, so the comparison ignores
// whitespace; foreign text comes back with single spaces.
export function classifyBox(box: string, ours: string): BoxState {
  const b = compact(box)
  const o = compact(ours)
  if (!b) return { kind: 'empty' }
  if (b === o) return { kind: 'exact' }
  // A long message is shown as "[Pasted text #N]", photos as "[Image #N]".
  if (PASTE_ONLY.test(box.trim()) && !o.includes('[Pastedtext#')) return { kind: 'exact' }
  if (o.startsWith(b)) return { kind: 'partial' }
  const at = b.indexOf(o)
  if (at >= 0) {
    // Back to the field's own characters: indexes of the non-blank ones.
    const raw: number[] = []
    for (let i = 0; i < box.length; i++) if (!/\s/.test(box[i]!)) raw.push(i)
    const before = tidy(box.slice(0, raw[at]))
    const after = tidy(box.slice(raw[at + o.length - 1]! + 1))
    const foreign = [before, after].filter(Boolean)
    if (foreign.some(f => new RegExp(PLACEHOLDER.source).test(f))) return { kind: 'unknown' }
    return { kind: 'glued', foreign }
  }
  // Our long text as a paste stand-in, foreign text beside it.
  const pastes = box.match(PLACEHOLDER) || []
  if (pastes.length === 1 && /^\[Pasted text/.test(pastes[0]!) && !o.includes('[Pastedtext#')) {
    const [before, after] = box.split(pastes[0]!).map(tidy)
    return { kind: 'glued', foreign: [before!, after!].filter(Boolean) }
  }
  return { kind: 'unknown' }
}

// Field read twice in a row with the same content (an ongoing paste or
// redraw has settled). null: not on screen.
async function settled(d: GuardDeps, o: Required<GuardOptions>): Promise<string | null> {
  let prev = await d.box()
  for (let i = 0; i < 20; i++) {
    await d.sleep(o.pollMs)
    const now = await d.box()
    if (now === prev) return now
    prev = now
  }
  return prev
}

// The field must stay empty for `quietMs` before we type: another writer's
// `agent.prompt` shows its text ~200 ms after it starts, and Claude takes a
// submitted message ~200 ms after its Enter; typing in either moment glues.
// Text that stays longer than `freeWaitMs` (a draft) refuses the send.
async function waitFree(d: GuardDeps, o: Required<GuardOptions>): Promise<void> {
  const now = d.now || Date.now
  const start = now()
  let emptySince: number | null = null
  for (;;) {
    const box = await d.box()
    if (box === null) throw new HerdrError('no_input', 'Agent input field not found')
    const t = now()
    emptySince = box ? null : emptySince ?? t
    if (emptySince !== null && t - emptySince >= o.quietMs) return
    if (box && t - start >= o.freeWaitMs) throw new HerdrError('input_busy', 'The agent’s input contains text')
    await d.sleep(o.pollMs)
  }
}

// Empties the field and checks it stays empty. Text that shows up after the
// clear is one more foreign message (kept when readable).
async function clearField(d: GuardDeps, o: Required<GuardOptions>, lines: number, foreign: string[]): Promise<void> {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    await d.keys(clearKeys(lines))
    await d.sleep(o.pollMs)
    const box = await settled(d, o)
    if (box === null) throw new HerdrError('no_input', 'Agent input field not found')
    if (!box) return
    if (new RegExp(PLACEHOLDER.source).test(box)) throw new HerdrError('clear_failed', 'Agent input not cleared: check its terminal')
    foreign.push(tidy(box))
    lines = box.split('\n').length
  }
  throw new HerdrError('clear_failed', 'Agent input not cleared: check its terminal')
}

// One message, typed and submitted alone. Foreign texts removed from the
// field on the way are added to `foreign`, even when the send then fails.
// The field is read once per poll and Enter pressed as soon as it holds our
// text alone: the shorter that moment, the less room for another writer.
async function sendOne(d: GuardDeps, text: string, o: Required<GuardOptions>, foreign: string[]): Promise<void> {
  const log = d.log || (() => {})
  const now = d.now || Date.now
  const start = now()
  const lines = (box: string) => box.split('\n').length + text.split('\n').length
  // Already submitted by someone else's Enter (alone, or glued to their text)?
  const recorded = async (): Promise<string | null> => {
    if (!d.sentSince) return null
    await d.sleep(RECORD_MS)
    const o = compact(text)
    return (await d.sentSince(start).catch(() => [])).find(m => compact(m).includes(o)) ?? null
  }
  // Foreign text separated, field cleared: unless another writer's Enter beat
  // us to it, in which case the glued message is out and nothing is typed again.
  const separate = async (box: string, parts: string[]): Promise<boolean> => {
    const before = foreign.length
    foreign.push(...parts)
    await clearField(d, o, lines(box), foreign)
    const m = await recorded()
    if (m === null) return false
    foreign.splice(before)
    log(`another writer submitted the field before it could be separated: ${JSON.stringify(m)}`)
    return true
  }
  await waitFree(d, o)
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await d.type(text)
    // 1. Our text shown, alone.
    let state: BoxState = { kind: 'empty' }
    let box: string | null = ''
    const typed = now()
    while (now() - typed < o.showWaitMs) {
      await d.sleep(o.pollMs)
      box = await d.box()
      if (box === null) throw new HerdrError('no_input', 'Agent input field not found')
      state = classifyBox(box, text)
      if (state.kind === 'glued' || state.kind === 'exact') break
      // Unknown: maybe a paste still being drawn; settled before deciding.
      if (state.kind === 'unknown' && (await settled(d, o)) === box) break
    }
    if (state.kind === 'empty' || state.kind === 'partial') {
      // Taken by another writer's Enter (our text alone: fine).
      if (state.kind === 'empty' && await recorded() !== null) return
      throw new HerdrError('not_shown', 'The message did not show in the agent’s input')
    }
    if (state.kind === 'glued') {
      log(`foreign text in the input before Enter, separated: ${JSON.stringify(state.foreign)}`)
      if (await separate(box!, state.foreign)) return
      continue
    }
    const sent = box!
    if (state.kind === 'unknown') log(`input holds more than our message and cannot be split: sent as it is (${JSON.stringify(sent)})`)
    // 2. Enter, then the field must empty.
    await d.keys(['enter'])
    let again = false
    let after: BoxState = state
    const entered = now()
    while (now() - entered < o.submitWaitMs) {
      await d.sleep(o.pollMs)
      box = await d.box()
      // Field gone (a menu, Claude redrawing) or emptied: taken.
      if (!box) return
      // What we submitted is still there as it was: not taken yet.
      const same = box === sent || (state.kind === 'exact' && classifyBox(box, text).kind === 'exact')
      if (!same) {
        after = state.kind === 'unknown' ? { kind: 'unknown' } : classifyBox(box, text)
        // Our text joined by another's before Claude took it.
        if (after.kind === 'glued') break
        // Replaced by other text: ours was taken, another writer typed since.
        return
      }
      // Still there alone: the Enter was lost, pressed once more.
      if (!again && now() - entered >= o.submitWaitMs / 3) {
        again = true
        log('message still in the input after Enter: Enter pressed again')
        await d.keys(['enter'])
      }
    }
    if (after.kind === 'glued') {
      log(`foreign text joined our message before it was taken, separated: ${JSON.stringify(after.foreign)}`)
      if (await separate(box!, after.foreign)) return
      continue
    }
    throw new HerdrError('not_submitted', 'The agent did not take the message')
  }
  throw new HerdrError('input_contended', 'Another writer keeps typing into the agent’s input')
}

// Error of a send that failed after taking foreign text out of the field:
// that text is in `unsent`, for the caller to keep.
export type GuardError = HerdrError & { unsent?: string[] }

// Our message, then each foreign text taken out of it, each in its own turn.
export async function guardedSend(d: GuardDeps, text: string, opts: GuardOptions = {}): Promise<GuardResult> {
  const o = { ...DEFAULTS, ...opts }
  const todo: string[] = []
  try { await sendOne(d, text, o, todo) }
  catch (e) {
    if (todo.length) (e as GuardError).unsent = todo
    throw e
  }
  const result: GuardResult = { foreign: [], unsent: [] }
  while (todo.length) {
    const f = todo.shift()!
    if (result.foreign.length >= MAX_FOREIGN) { result.unsent.push(f); continue }
    try {
      await sendOne(d, f, o, todo)
      result.foreign.push(f)
      d.log?.(`foreign message typed back after ours: ${JSON.stringify(f)}`)
    } catch (e) {
      d.log?.(`foreign message not typed back (${(e as Error).message}): kept`)
      result.unsent.push(f, ...todo.splice(0))
    }
  }
  return result
}

// wherdr's own sends to a pane, one at a time.
const locks = new Map<string, Promise<unknown>>()
export function withPaneLock<T>(paneId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(paneId) || Promise.resolve()
  const run = prev.catch(() => {}).then(fn)
  const tail = run.catch(() => {})
  locks.set(paneId, tail)
  tail.then(() => { if (locks.get(paneId) === tail) locks.delete(paneId) })
  return run
}
