// Answer a question of a herdr-core agent (WHR-260): the screen is read again
// right before, and a changed question is refused rather than confirmed blindly.
// A choice is terminal.keys; a free answer selects its option, waits for the
// field to open, then pastes the text with terminal.send.
import { HerdrError } from './herdr'
import { failure, type CoreInputDeps } from './coreInput'
import { readCoreScreen } from './coreScreen'
import { keysFor, sameQuestion, completeClaudeAsk, type ClaudeAsked } from './choices'
import type { Pane } from '../../shared/types'

export interface CoreChooseDeps extends CoreInputDeps {
  read: (p: Pane) => Promise<string>
  asked?: (p: Pane) => Promise<ClaudeAsked[]>
  sleep?: (ms: number) => Promise<void>
}
type Body = { pane_id?: unknown, index?: unknown, label?: unknown, identity?: unknown, text?: unknown, question?: unknown }

const stale = () => new HerdrError('stale', 'The question has changed — check the current screen.')

export async function coreChoose(deps: CoreChooseDeps, b: Body) {
  const p = typeof b.pane_id === 'string' ? deps.pane(b.pane_id) : undefined
  if (!p?.coreAddress) throw new HerdrError('bad_pane', 'Pane not found')
  const sleep = deps.sleep ?? (ms => new Promise<void>(r => setTimeout(r, ms)))
  const answer = typeof b.text === 'string' ? b.text.trim() : ''
  try {
    const screen = async () => {
      const text = await deps.read(p)
      const r = readCoreScreen(text, p.agent, p.status)
      let choices = r.choices
      if (choices && p.agent === 'claude' && deps.asked) choices = completeClaudeAsk(choices, await deps.asked(p).catch(() => []))
      return { text, choices, interaction: r.interaction }
    }
    const now = await screen()
    const i = Number(b.index)
    const option = now.choices?.options[i]
    if (!now.choices || now.interaction !== 'native' || !b.identity || now.choices.identity !== b.identity || !option
      || option.label !== b.label || (answer && !option.free)
      || (option.free && !sameQuestion(now.choices.question, typeof b.question === 'string' ? b.question : null))) throw stale()
    if (option.free && !answer) throw new HerdrError('bad_text', 'Write your answer before sending it.')
    await deps.call('terminal.keys', { terminal: p.coreAddress, keys: keysFor(now.choices, i) }, 10000)
    if (option.free) {
      // The text goes to the field the option opens, never to the question itself.
      for (let tries = 0; ; tries++) {
        await sleep(300)
        const after = await screen()
        if (after.choices?.identity !== now.choices.identity) break
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
    const now = readCoreScreen(await deps.read(p), p.agent, p.status)
    if (!now.choices || now.interaction !== 'native' || now.choices.identity !== b.identity) throw stale()
    await deps.call('terminal.keys', { terminal: p.coreAddress, keys }, 10000)
    return { ok: true }
  } catch (e) { failure(e) } finally { deps.refresh() }
}
