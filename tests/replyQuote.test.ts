import { describe, expect, it } from 'vitest'
import { dropReplyMarker, findReplyOrigin, MARKER_MAX, parseReply, plainText, replyMarker, replyTarget, truncate, withReply } from '../shared/replyQuote'
import { restoreDraft } from '../app/utils/queuedCancel'
import { queuedPhase } from '../shared/queuedPhase'

const LONG = 'Je propose deux options : **garder** le cache actuel et le borner à 50 Mo, ou le remplacer par IndexedDB avec une purge au démarrage. La seconde est plus propre mais plus longue.'

describe('reply marker', () => {
  it('builds a short marker in French and English', () => {
    const r = replyTarget('Je propose deux options : A ou B.', '14:32', 'fr')
    expect(replyMarker(r, 'fr')).toBe('↳ En réponse à ton message de 14:32 (« Je propose deux options : A ou B. »)')
    expect(replyMarker(replyTarget('Two options: A or B.', '2:32 PM', 'en'), 'en')).toBe('↳ Replying to your message from 2:32 PM ("Two options: A or B.")')
  })

  it('truncates a long message without exceeding ~120 characters', () => {
    for (const lang of ['fr', 'en'] as const) {
      const r = replyTarget(LONG, '14:32', lang)
      expect(r.excerpt.endsWith('…')).toBe(true)
      expect(r.excerpt).not.toContain('**')
      expect(replyMarker(r, lang).length).toBeLessThanOrEqual(MARKER_MAX)
    }
  })

  it('puts the marker before the reply, separated by an empty line', () => {
    const r = replyTarget('Option A ?', '14:32', 'fr')
    expect(withReply(r, 'Oui, A.', 'fr')).toBe('↳ En réponse à ton message de 14:32 (« Option A ? »)\n\nOui, A.')
    expect(withReply(null, 'Oui', 'fr')).toBe('Oui')
  })

  it('cleans the markdown and cuts on a word', () => {
    expect(plainText('## Titre\n- `code` et [lien](http://x)')).toBe('Titre code et lien')
    expect(truncate('un deux trois quatre', 15)).toBe('un deux trois…')
  })
})

describe('displaying a reply', () => {
  it('recognizes the marker (two languages) and returns the body', () => {
    const text = withReply(replyTarget(LONG, '14:32', 'fr'), 'Plutôt la seconde.\nMerci', 'fr')
    const p = parseReply(text)!
    expect(p.reply.time).toBe('14:32')
    expect(p.reply.excerpt.startsWith('Je propose deux options')).toBe(true)
    expect(p.body).toBe('Plutôt la seconde.\nMerci')
    expect(parseReply(withReply(replyTarget('Two options', '2:32 PM', 'en'), 'B', 'en'))!.body).toBe('B')
    expect(parseReply('Un message ordinaire')).toBeNull()
    expect(parseReply('↳ autre chose')).toBeNull()
  })

  it('finds the original message by time and start of the text', () => {
    const list = [
      { key: 'a', time: '14:30', text: 'Je propose deux options : A.' },
      { key: 'b', time: '14:32', text: LONG },
      { key: 'c', time: '14:32', text: 'Autre chose' },
    ]
    expect(findReplyOrigin(list, replyTarget(LONG, '14:32', 'fr'))?.key).toBe('b')
    // Passage quoted by an older version (middle of the message).
    expect(findReplyOrigin(list, { time: '14:32', excerpt: 'La seconde est plus propre' })?.key).toBe('b')
    // Different time (other time zone): the excerpt is enough.
    expect(findReplyOrigin(list, { time: '16:32', excerpt: 'Autre chose' })?.key).toBe('c')
    expect(findReplyOrigin(list, { time: '10:00', excerpt: 'introuvable' })).toBeNull()
  })

  it('puts the reply box back into the draft when a queued message is cancelled', () => {
    const d = { text: '', atts: [], reply: null } as Parameters<typeof restoreDraft>[0]
    restoreDraft(d, withReply({ time: '14:32', excerpt: 'Option A ?' }, 'Oui', 'fr'))
    expect(d.reply).toEqual({ time: '14:32', excerpt: 'Option A ?' })
    expect(d.text).toBe('Oui')
  })

  it('does not confuse two replies to the same message in the queue', () => {
    const r = { time: '14:32', excerpt: 'Je propose deux options : garder le cache actuel et le borner à 50 Mo…' }
    const one = withReply(r, 'Premier avis détaillé ici', 'fr')
    const two = withReply(r, 'Second avis tout à fait différent', 'fr')
    expect(dropReplyMarker(one.replace(/\s+/g, ' ').toLowerCase())).toBe('premier avis détaillé ici')
    const screen = { queued: [two], sent: one } as unknown as Parameters<typeof queuedPhase>[1]
    expect(queuedPhase(one, screen)).toBe('sent')
    expect(queuedPhase(two, screen)).toBe('queued')
  })
})
