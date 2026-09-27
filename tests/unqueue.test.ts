// « Annuler » un message en attente chez Claude Code : lecture du champ de
// saisie dans l'écran, et séquence ↑ / vidage / remise en file jouée contre un
// faux Claude qui imite celui observé (2.1.283, session hwtest).
import { describe, expect, it } from 'vitest'
import { clearKeys, inputBox, msgText, unqueueClaude } from '../server/utils/unqueue'
import { canCancelQueued, restoreDraft } from '../app/utils/queuedCancel'
import type { ChatItem, ClaudeQueueEntry, Pane } from '../shared/types'

const E = '\x1b'
const RULE = `${E}[38;2;80;80;80m${'─'.repeat(40)}${E}[0m\r`
// Écrans ANSI relevés sur le vrai Claude Code (simplifiés).
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
  it('vide, avec ou sans texte d’aide grisé', () => {
    expect(inputBox(screen([], []))).toBe('')
    expect(inputBox(screen(['Message en file'], []))).toBe('')
  })
  it('lit le texte tapé, sur plusieurs lignes, sans confondre la file', () => {
    expect(inputBox(screen(['A'], ['Premier en file', '[Pasted text #1 +11 lines]']))).toBe('Premier en file\n[Pasted text #1 +11 lines]')
    expect(inputBox('❯ abc\r')).toBe('abc')
  })
  it('introuvable (menu, autre écran)', () => {
    expect(inputBox('Do you trust this folder?\n❯ 1. Yes')).toBeNull()
  })
  it('touches de vidage : Ctrl+U puis Retour arrière par ligne, bornées', () => {
    expect(clearKeys(1)).toEqual(['ctrl+u', 'backspace', 'ctrl+u', 'backspace', 'ctrl+u', 'backspace'])
    expect(clearKeys(10000).length).toBe(400)
  })
  it('texte sans chemins de photos', () => {
    expect(msgText('Regarde\n/home/user/.cache/herdr-web/uploads/a.jpg')).toBe('Regarde')
  })
})

// Faux Claude : file, champ de saisie, conversation. ↑ ramène toute la file
// dans le champ (popAll) ; `take` simule la fin de tour qui prend la file.
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
      // Transcription en retard de `lag` lectures sur l'état réel.
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
  it('le seul message : rappelé, champ vidé, rien de remis', async () => {
    const { st, deps } = fakeClaude(['Message en file\ndeuxième ligne'])
    expect(await unqueueClaude(deps, 'Message en file\ndeuxième ligne')).toEqual({ requeued: [] })
    expect(st.keys[0]).toBe('up')
    expect(st.input).toEqual([])
    expect(st.queue).toEqual([])
  })

  it('plusieurs : les autres sont remis en file, dans l’ordre, texte d’origine', async () => {
    const { st, deps } = fakeClaude(['Premier', 'Collé\nsur\ntrois lignes', 'Troisième'])
    const r = await unqueueClaude({ ...deps, original: t => (t === 'Premier' ? 'Premier\n/home/n/.cache/herdr-web/uploads/p.jpg' : t) }, 'Collé\nsur\ntrois lignes')
    expect(r.requeued).toEqual(['Premier\n/home/n/.cache/herdr-web/uploads/p.jpg', 'Troisième'])
    expect(st.queue).toEqual(['Premier\n/home/n/.cache/herdr-web/uploads/p.jpg', 'Troisième'])
    expect(st.input).toEqual([])
  })

  it('transcription en retard : ↑ a ramené toute la file, rien n’est perdu', async () => {
    const { st, deps } = fakeClaude(['A', 'B'], { lagChat: 100 })
    const r = await unqueueClaude(deps, 'B')
    expect(r.requeued).toEqual(['A'])
    expect(st.queue).toEqual(['A'])
  })

  it('déjà lu (plus dans la file) : refusé sans toucher au terminal', async () => {
    const { st, deps } = fakeClaude(['Autre chose'])
    await expect(unqueueClaude(deps, 'Mon message')).rejects.toMatchObject({ code: 'already_read' })
    expect(st.keys).toEqual([])
  })

  it('course : le tour prend la file juste avant ↑ → historique effacé, prévenu', async () => {
    const { st, deps } = fakeClaude(['Mon message'], { take: true })
    await expect(unqueueClaude(deps, 'Mon message')).rejects.toMatchObject({ code: 'already_read' })
    expect(st.input).toEqual([])
    expect(st.sent).toEqual([])
  })

  it('champ de l’agent occupé (brouillon tapé sur l’ordinateur) : on n’y touche pas', async () => {
    const { st, deps } = fakeClaude(['Mon message'], { typed: ['brouillon'] })
    await expect(unqueueClaude(deps, 'Mon message')).rejects.toMatchObject({ code: 'input_busy' })
    expect(st.keys).toEqual([])
  })

  it('champ impossible à vider : erreur, et surtout rien de remis en file', async () => {
    const { st, deps } = fakeClaude(['A', 'B'], { stuck: true })
    await expect(unqueueClaude(deps, 'B')).rejects.toMatchObject({ code: 'clear_failed' })
    expect(st.sent).toEqual([])
  })
})

describe('bouton et brouillon', () => {
  const pane = (x: Partial<Pane>) => ({ id: 'w1:p1', agent: 'claude', status: 'working', ...x }) as Pane
  it('bouton : Claude au travail, ou message pas encore parti', () => {
    expect(canCancelQueued(pane({}))).toBe(true)
    expect(canCancelQueued(pane({ status: 'idle' }))).toBe(false)
    expect(canCancelQueued(pane({ status: 'blocked' }))).toBe(false)
    expect(canCancelQueued(pane({ agent: 'codex' }))).toBe(false)
    expect(canCancelQueued(pane({ agent: 'codex', status: 'idle', pendingPrompt: true }))).toBe(true)
    expect(canCancelQueued(undefined)).toBe(false)
  })
  it('texte remis avant le brouillon, photos rejointes une seule fois', () => {
    const d = { text: 'déjà tapé', atts: [] as { url: string, path: string | null, name?: string }[] }
    const msg = 'Regarde ça\n/home/user/.cache/herdr-web/uploads/2026-09-26T00-36-39-393Z-4fa305.jpg'
    restoreDraft(d, msg)
    restoreDraft(d, msg)
    expect(d.text).toBe('Regarde ça\nRegarde ça\ndéjà tapé')
    expect(d.atts).toEqual([{ url: '/uploads/2026-09-26T00-36-39-393Z-4fa305.jpg', path: '/home/user/.cache/herdr-web/uploads/2026-09-26T00-36-39-393Z-4fa305.jpg', name: '2026-09-26T00-36-39-393Z-4fa305.jpg' }])
  })
})
