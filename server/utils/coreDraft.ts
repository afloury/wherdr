// Text left unsent in Claude Code's own input box on herdr-core (WHR-286): a
// paste or a draft never submitted, or the prompt Claude put back after an
// interrupt. The conversation shows it as "Not sent" with Send now / Clear.
// Claude's own queue ("ctrl+enter to send now" under a queued message) gets
// Send now too. Every action re-reads the screen first and refuses a box that
// changed since it was shown.
import { HerdrError } from './herdr'
import { failure, type CoreInputDeps } from './coreInput'
import { readCoreScreen } from './coreScreen'
import { clearKeys, inputBox } from './unqueue'
import { parseClaudeScreen } from './claudeScreen'
import type { CoreDraft, Pane } from '../../shared/types'

// Core's screen is plain text, but it keeps the non-breaking space Claude puts
// after the "❯" of its field (sent messages above have a normal one), so
// inputBox finds the field. Its gray placeholder ('Try "…"') reads empty.
// A gray next-message suggestion is drawn after the cursor: "❯  text"
// (one more space than typed text). Without colors that space is the only
// sign, so such a one-line box is not taken as a draft.
const SUGGESTION = /^❯  \S/

/** Pure: the unsent text in Claude's field on a core screen, or null. */
export function readDraft(text: string, agent: string | null | undefined): CoreDraft | null {
  if (agent !== 'claude') return null
  const box = inputBox(text)
  if (!box || box === '!') return null
  const lines = box.split('\n').length
  if (lines === 1) {
    const field = String(text).split('\n').findLast(l => l.startsWith('❯ '))
    if (field && SUGGESTION.test(field)) return null
  }
  return { text: box, lines }
}

/** Pure: Claude offers to send its queued messages now (ctrl+enter). */
export function queueSendNow(text: string, agent: string | null | undefined): boolean {
  return agent === 'claude' && Boolean(parseClaudeScreen(text)?.sendNow)
}

export interface CoreDraftDeps extends CoreInputDeps {
  read: (p: Pane) => Promise<string>
  sleep?: (ms: number) => Promise<void>
}
type Body = { pane_id?: unknown, action?: unknown, text?: unknown }

const norm = (t: string) => t.replace(/\s+/g, '')
const changed = () => new HerdrError('stale', 'Claude’s input has changed — check the current screen.')

export async function coreDraft(deps: CoreDraftDeps, b: Body): Promise<{ ok: true, started?: boolean }> {
  const p = typeof b.pane_id === 'string' ? deps.pane(b.pane_id) : undefined
  if (!p?.coreAddress) throw new HerdrError('bad_pane', 'Pane not found')
  if (p.agent !== 'claude') throw new HerdrError('unsupported', 'Only for Claude Code')
  const action = b.action
  if (action !== 'send' && action !== 'clear' && action !== 'send-queued') throw new HerdrError('bad_action', 'Invalid action')
  const sleep = deps.sleep ?? (ms => new Promise<void>(r => setTimeout(r, ms)))
  const keys = (k: string[]) => deps.call('terminal.keys', { terminal: p.coreAddress, keys: k }, 10000)
  const turn = async () => (await deps.call<{ turn?: number, status?: string | { state?: string } | null }>('terminal.get', { terminal: p.coreAddress }, 3000).catch(() => null))
  try {
    const screen = await deps.read(p)
    if (action === 'send-queued') {
      if (!queueSendNow(screen, p.agent)) throw new HerdrError('stale', 'The screen has changed — check the current screen.')
      await keys(['ctrl+enter'])
      return { ok: true }
    }
    const draft = readDraft(screen, p.agent)
    if (!draft || typeof b.text !== 'string' || norm(draft.text) !== norm(b.text)) throw changed()
    if (action === 'clear') {
      for (let i = 0; i < 2; i++) {
        await keys(clearKeys(draft.lines))
        await sleep(150)
        const now = readDraft(await deps.read(p), p.agent)
        if (!now) return { ok: true }
        // Someone is typing in the terminal: their new text is left alone.
        if (norm(now.text) !== norm(draft.text)) break
      }
      throw new HerdrError('clear_failed', 'Claude’s input could not be emptied — check the terminal.')
    }
    // Send now: Enter, then the box must empty and a turn start (spinner,
    // core's working status or a new turn number).
    const before = (await turn())?.turn
    await keys(['enter'])
    let emptied = false
    let started = false
    for (let i = 0; i < 8 && !(emptied && started); i++) {
      await sleep(400)
      const now = await deps.read(p).catch(() => null)
      if (now === null) continue
      emptied = !readDraft(now, p.agent)
      const t = await turn()
      const state = typeof t?.status === 'string' ? t.status : t?.status?.state
      started = readCoreScreen(now, p.agent, null).status === 'working' || state === 'working'
        || (typeof before === 'number' && typeof t?.turn === 'number' && t.turn > before)
    }
    if (!emptied) throw new HerdrError('not_submitted', 'Enter was pressed but the text is still in Claude’s input — check the terminal.')
    return { ok: true, started }
  } catch (e) { failure(e) } finally { deps.refresh() }
}
