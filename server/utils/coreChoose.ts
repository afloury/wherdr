// Answer a question of a herdr-core agent (WHR-260): the screen is read again
// right before, and a changed question is refused rather than confirmed blindly.
// "Changed" means another request (WHR-607): the same pending tool call, or the
// same loose screen key (looseIdentity), still takes the answer; a mismatch is
// read once more 300 ms later (a redraw, a transcript catching up).
// A choice is terminal.keys; a free answer selects its option, waits for the
// field to open, then pastes the text with terminal.send.
import { HerdrError } from './herdr'
import { failure, type CoreInputDeps } from './coreInput'
import { readCoreScreen, withTranscript, type TranscriptDeps } from './coreScreen'
import { keysFor, sameQuestion, sameOptionLabel, promptIdentity } from './choices'
import type { Choices, Pane } from '../../shared/types'

export interface CoreChooseDeps extends CoreInputDeps, TranscriptDeps {
  read: (p: Pane) => Promise<string>
  sleep?: (ms: number) => Promise<void>
}
type Body = { pane_id?: unknown, index?: unknown, label?: unknown, identity?: unknown, text?: unknown, question?: unknown }

const stale = () => new HerdrError('stale', 'The question has changed — check the current screen.')
const RETRY_MS = 300
const sleeper = (deps: CoreChooseDeps) => deps.sleep ?? (ms => new Promise<void>(r => setTimeout(r, ms)))

// The prompt on screen now, as the card was made (coreScreen.enrich): its
// identity from the transcript when it names the call; `loose` is the screen's
// own key, which a card made while the transcript lagged carries.
async function readPrompt(deps: CoreChooseDeps, p: Pane) {
  const text = await deps.read(p)
  const r = readCoreScreen(text, p.agent, p.status)
  const choices: Choices | null = r.choices && await withTranscript(deps, p, r.choices, text)
  return { text, choices, loose: r.choices?.identity, interaction: r.interaction }
}
// Read until `ok` holds, once more after RETRY_MS; refused otherwise.
async function samePrompt(deps: CoreChooseDeps, p: Pane, identity: unknown, ok: (c: Choices) => boolean = () => true) {
  for (let tries = 0; ; tries++) {
    const now = await readPrompt(deps, p)
    const c = now.choices
    if (c && now.interaction === 'native' && identity && (c.identity === identity || now.loose === identity) && ok(c)) return { ...now, choices: c }
    if (tries) throw stale()
    await sleeper(deps)(RETRY_MS)
  }
}

export async function coreChoose(deps: CoreChooseDeps, b: Body) {
  const p = typeof b.pane_id === 'string' ? deps.pane(b.pane_id) : undefined
  if (!p?.coreAddress) throw new HerdrError('bad_pane', 'Pane not found')
  const sleep = sleeper(deps)
  const answer = typeof b.text === 'string' ? b.text.trim() : ''
  try {
    const i = Number(b.index)
    const now = await samePrompt(deps, p, b.identity, c => sameOptionLabel(c.options[i]?.label, b.label))
    const option = now.choices.options[i]!
    if ((answer && !option.free)
      || (option.free && !sameQuestion(now.choices.question, typeof b.question === 'string' ? b.question : null))) throw stale()
    if (option.free && !answer) throw new HerdrError('bad_text', 'Write your answer before sending it.')
    const keys = keysFor(now.choices, i)
    if (keys.length) await deps.call('terminal.keys', { terminal: p.coreAddress, keys }, 10000)
    if (option.free && now.choices.form) {
      // omp's form types in place: wait for the cursor to reach the row, then send the text.
      // omp is blocked on its question, which core refuses to type into without `force`;
      // terminal.send presses Enter itself, so the answer is confirmed (or, in a checkbox
      // group, checked and gone on from) by that send.
      for (let tries = 0; ; tries++) {
        if (tries) await sleep(150)
        const after = await readPrompt(deps, p)
        if (after.choices?.identity === now.choices.identity && after.choices?.cursor === i) break
        if (tries >= 6) throw new HerdrError('stale', 'The answer field did not open — check the current screen.')
      }
      await deps.call('terminal.send', { terminal: p.coreAddress, text: answer, force: true }, 30000)
    } else if (option.free) {
      // The text goes to the field the option opens, never to the question itself:
      // the screen must change (exact identity: the request itself stays the same).
      const before = promptIdentity(now.text, p.agent)
      for (let tries = 0; ; tries++) {
        await sleep(300)
        if (promptIdentity(await deps.read(p), p.agent) !== before) break
        if (tries >= 6) throw new HerdrError('stale', 'The answer field did not open — check the current screen.')
      }
      await deps.call('terminal.send', { terminal: p.coreAddress, text: answer }, 30000)
    }
    return { ok: true }
  } catch (e) { failure(e) } finally { deps.refresh() }
}

// Keyboard on a "Your turn" card (↑ ↓ Enter Esc, ←/→ between omp tabs): the
// keys go to the terminal only while the same question is on screen.
const NAV_KEYS = new Set(['up', 'down', 'enter', 'esc', 'left', 'right'])
export async function coreNav(deps: CoreChooseDeps, b: { pane_id?: unknown, keys?: unknown, identity?: unknown }) {
  const p = typeof b.pane_id === 'string' ? deps.pane(b.pane_id) : undefined
  if (!p?.coreAddress) throw new HerdrError('bad_pane', 'Pane not found')
  const keys = Array.isArray(b.keys) ? b.keys : []
  if (!keys.length || keys.length > 8 || !keys.every(k => typeof k === 'string' && NAV_KEYS.has(k))) throw new HerdrError('bad_keys', 'Invalid keys')
  try {
    await samePrompt(deps, p, b.identity)
    await deps.call('terminal.keys', { terminal: p.coreAddress, keys }, 10000)
    return { ok: true }
  } catch (e) { failure(e) } finally { deps.refresh() }
}
