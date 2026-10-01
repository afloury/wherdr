// "Cancel" a queued message in Claude Code: reading the input field from the
// screen, and ↑ / clear / requeue sequence played against a
// fake Claude imitating the observed one (2.1.283, hwtest session).
import { describe, expect, it } from 'vitest'
import { clearKeys, inputBox, msgText, unqueueClaude } from '../server/utils/unqueue'
import { canCancelQueued, restoreDraft } from '../app/utils/queuedCancel'
import type { ChatItem, ClaudeQueueEntry, Pane } from '../shared/types'

const E = '\x1b'
const RULE = `${E}[38;2;80;80;80m${'─'.repeat(40)}${E}[0m\r`
// ANSI screens captured on the real Claude Code (simplified).
const queuedLine = (t: string) => `${E}[0m${E}[38;2;80;80;80m${E}[48;2;55;55;55m❯ ${E}[0m${E}[38;2;153;153;153m${E}[48;2;55;55;55m${t}${E}[0m\r`
const screen = (queue: string[], input: string[]) => [
  '  12. La mer est salée.',
  ...queue.map(queuedLine),
  RULE,
  input.length
    ? [`${E}[0m${E}[38;2;153;153;153m❯ ${E}[0m${input[0]}\r`, ...input.slice(1).map(l => `  ${l}\r`)].join('\n')
    : `${E}[0m${E}[38;2;153;153;153m❯ ${E}[0m${queue.length ? `${E}[2mPress up to edit queued messages${E}[0m` : ''}\r`,
  RULE,
  '  ⏸ manual mode on · ← for agents',
].join('\n')

describe('champ de saisie de Claude Code', () => {
  it('empty, with or without grayed-out help text', () => {
    expect(inputBox(screen([], []))).toBe('')
    expect(inputBox(screen(['Message en file'], []))).toBe('')
  })
  it('reads the typed text, over several lines, without confusing the queue', () => {
    expect(inputBox(screen(['A'], ['Premier en file', '[Pasted text #1 +11 lines]']))).toBe('Premier en file\n[Pasted text #1 +11 lines]')
    expect(inputBox('❯ abc\r')).toBe('abc')
  })
  it('not found (menu, other screen)', () => {
    expect(inputBox('Do you trust this folder?\n❯ 1. Yes')).toBeNull()
  })
  it('clearing keys: Ctrl+U then Backspace per line, bounded', () => {
    expect(clearKeys(1)).toEqual(['ctrl+u', 'backspace', 'ctrl+u', 'backspace', 'ctrl+u', 'backspace'])
    expect(clearKeys(10000).length).toBe(400)
  })
  it('texte sans chemins de photos', () => {
    expect(msgText('Regarde\n/home/user/.cache/herdr-web/uploads/a.jpg')).toBe('Regarde')
  })
})

// Fake Claude: queue, input field, conversation. ↑ brings the whole queue
// into the field (popAll); `take` simulates the end of turn that takes the queue.
function fakeClaude(queue: string[], opts: { take?: boolean, lagChat?: number, stuck?: boolean, typed?: string[] } = {}) {
  const st = { queue: [...queue], input: [...(opts.typed || [])] as string[], items: [] as ChatItem[], sent: [] as string[], keys: [] as string[], lag: opts.lagChat || 0 }
  const q = (): ClaudeQueueEntry[] => st.queue.map(text => ({ text, ts: null }))
  let shown = q()
  const deps = {
    screen: async () => screen(st.queue, st.input),
    keys: async (keys: string[]) => {
      st.keys.push(...keys)
      for (const k of keys) {
        if (k === 'up') {
          if (opts.take) {
            st.items.push({ role: 'user', text: st.queue.join('\n'), ts: null })
            st.queue = []
            st.input = ['message précédent']
          } else {
            st.input = st.queue.flatMap(t => t.split('\n'))
            st.queue = []
          }
        } else if (k === 'ctrl+u' && !opts.stuck) {
          if (st.input.length) st.input[st.input.length - 1] = ''
        } else if (k === 'backspace' && !opts.stuck) {
          if (st.input.length && !st.input[st.input.length - 1]) st.input.pop()
        }
      }
    },
    chat: async () => {
      // Transcript lagging `lag` reads behind the real state.
      if (st.lag > 0) st.lag--
      else shown = q()
      return { queue: shown, items: [...st.items] }
    },
    prompt: async (t: string) => {
      if (st.input.length) throw new Error('le champ aurait été envoyé avec')
      st.sent.push(t)
      st.queue.push(t)
    },
    sleep: async () => {},
  }
  return { st, deps }
}

describe('annuler un message en file de Claude', () => {
  it('the only message: recalled, field cleared, nothing requeued', async () => {
    const { st, deps } = fakeClaude(['Message en file\ndeuxième ligne'])
    expect(await unqueueClaude(deps, 'Message en file\ndeuxième ligne')).toEqual({ requeued: [] })
    expect(st.keys[0]).toBe('up')
    expect(st.input).toEqual([])
    expect(st.queue).toEqual([])
  })

  it('several: the others are requeued, in order, original text', async () => {
    const { st, deps } = fakeClaude(['Premier', 'Collé\nsur\ntrois lignes', 'Troisième'])
    const r = await unqueueClaude({ ...deps, original: t => (t === 'Premier' ? 'Premier\n/home/n/.cache/herdr-web/uploads/p.jpg' : t) }, 'Collé\nsur\ntrois lignes')
    expect(r.requeued).toEqual(['Premier\n/home/n/.cache/herdr-web/uploads/p.jpg', 'Troisième'])
    expect(st.queue).toEqual(['Premier\n/home/n/.cache/herdr-web/uploads/p.jpg', 'Troisième'])
    expect(st.input).toEqual([])
  })

  it('lagging transcript: ↑ brought back the whole queue, nothing is lost', async () => {
    const { st, deps } = fakeClaude(['A', 'B'], { lagChat: 100 })
    const r = await unqueueClaude(deps, 'B')
    expect(r.requeued).toEqual(['A'])
    expect(st.queue).toEqual(['A'])
  })

  it('already read (no longer in the queue): refused without touching the terminal', async () => {
    const { st, deps } = fakeClaude(['Autre chose'])
    await expect(unqueueClaude(deps, 'Mon message')).rejects.toMatchObject({ code: 'already_read' })
    expect(st.keys).toEqual([])
  })

  it('race: the turn takes the queue just before ↑ → history erased, warned', async () => {
    const { st, deps } = fakeClaude(['Mon message'], { take: true })
    await expect(unqueueClaude(deps, 'Mon message')).rejects.toMatchObject({ code: 'already_read' })
    expect(st.input).toEqual([])
    expect(st.sent).toEqual([])
  })

  it('agent field busy (draft typed on the computer): left untouched', async () => {
    const { st, deps } = fakeClaude(['Mon message'], { typed: ['brouillon'] })
    await expect(unqueueClaude(deps, 'Mon message')).rejects.toMatchObject({ code: 'input_busy' })
    expect(st.keys).toEqual([])
  })

  it('field impossible to clear: error, and above all nothing requeued', async () => {
    const { st, deps } = fakeClaude(['A', 'B'], { stuck: true })
    await expect(unqueueClaude(deps, 'B')).rejects.toMatchObject({ code: 'clear_failed' })
    expect(st.sent).toEqual([])
  })
})

describe('bouton et brouillon', () => {
  const pane = (x: Partial<Pane>) => ({ id: 'w1:p1', agent: 'claude', status: 'working', ...x }) as Pane
  it('button: Claude working, or message not sent yet', () => {
    expect(canCancelQueued(pane({}))).toBe(true)
    expect(canCancelQueued(pane({ status: 'idle' }))).toBe(false)
    expect(canCancelQueued(pane({ status: 'blocked' }))).toBe(false)
    expect(canCancelQueued(pane({ agent: 'codex' }))).toBe(false)
    expect(canCancelQueued(pane({ agent: 'codex', status: 'idle', pendingPrompt: true }))).toBe(true)
    expect(canCancelQueued(undefined)).toBe(false)
  })
  it('text put back before the draft, photos attached only once', () => {
    const d = { text: 'déjà tapé', atts: [] as { url: string, path: string | null, name?: string }[] }
    const msg = 'Regarde ça\n/home/user/.cache/herdr-web/uploads/2026-09-26T00-36-39-393Z-4fa305.jpg'
    restoreDraft(d, msg)
    restoreDraft(d, msg)
    expect(d.text).toBe('Regarde ça\nRegarde ça\ndéjà tapé')
    expect(d.atts).toEqual([{ url: '/uploads/2026-09-26T00-36-39-393Z-4fa305.jpg', path: '/home/user/.cache/herdr-web/uploads/2026-09-26T00-36-39-393Z-4fa305.jpg', name: '2026-09-26T00-36-39-393Z-4fa305.jpg' }])
  })
})
