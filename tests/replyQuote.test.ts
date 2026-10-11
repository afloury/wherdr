import { describe, expect, it } from 'vitest'
import { dropReplyMarker, findReplyOrigin, parseReply, plainText, truncate } from '../shared/replyQuote'
import { messageRef, refLine } from '../shared/reference'
import { restoreDraft } from '../app/utils/queuedCancel'
import { queuedPhase } from '../shared/queuedPhase'

const LONG = 'Je propose deux options : **garder** le cache actuel et le borner à 50 Mo, ou le remplacer par IndexedDB avec une purge au démarrage. La seconde est plus propre mais plus longue.'

// The marker written before the references (shared/reference.ts), as the
// messages already sent hold it.
const old = (time: string, excerpt: string, body: string, lang: 'fr' | 'en' = 'fr') =>
  (lang === 'en' ? `↳ Replying to your message from ${time} ("${excerpt}")` : `↳ En réponse à ton message de ${time} (« ${excerpt} »)`) + `\n\n${body}`

describe('text of a reference', () => {
  it('cleans the markdown and cuts on a word', () => {
    expect(plainText('## Titre\n- `code` et [lien](http://x)')).toBe('Titre code et lien')
    expect(truncate('un deux trois quatre', 15)).toBe('un deux trois…')
  })
})

describe('displaying a reply', () => {
  it('recognizes the marker (two languages) and returns the body', () => {
    const p = parseReply(old('14:32', 'Je propose deux options : garder le cache actuel…', 'Plutôt la seconde.\nMerci'))!
    expect(p.reply.time).toBe('14:32')
    expect(p.reply.excerpt.startsWith('Je propose deux options')).toBe(true)
    expect(p.body).toBe('Plutôt la seconde.\nMerci')
    expect(parseReply(old('2:32 PM', 'Two options', 'B', 'en'))!.body).toBe('B')
    expect(parseReply('Un message ordinaire')).toBeNull()
    expect(parseReply('↳ autre chose')).toBeNull()
  })

  it('finds the original message by time and start of the text', () => {
    const list = [
      { key: 'a', time: '14:30', text: 'Je propose deux options : A.' },
      { key: 'b', time: '14:32', text: LONG },
      { key: 'c', time: '14:32', text: 'Autre chose' },
    ]
    expect(findReplyOrigin(list, { time: '14:32', excerpt: messageRef(LONG, '14:32').excerpt })?.key).toBe('b')
    // Passage quoted by an older version (middle of the message).
    expect(findReplyOrigin(list, { time: '14:32', excerpt: 'La seconde est plus propre' })?.key).toBe('b')
    // Different time (other time zone): the excerpt is enough.
    expect(findReplyOrigin(list, { time: '16:32', excerpt: 'Autre chose' })?.key).toBe('c')
    expect(findReplyOrigin(list, { time: '10:00', excerpt: 'introuvable' })).toBeNull()
  })

  it('gives a cancelled message of an earlier version its reference back in the draft', () => {
    const d = { text: '', atts: [] } as Parameters<typeof restoreDraft>[0]
    restoreDraft(d, old('14:32', 'Option A ?', 'Oui'))
    expect(d.text).toBe('↳ Quote message 14:32 : Option A ? —\nOui')
  })

  it('does not confuse two replies to the same message in the queue', () => {
    const excerpt = 'Je propose deux options : garder le cache actuel et le borner à 50 Mo…'
    for (const head of [refLine({ kind: 'message', label: '', time: '14:32', n: null, id: null, excerpt }), old('14:32', excerpt, '').trimEnd()]) {
      const one = `${head}\nPremier avis détaillé ici`
      const two = `${head}\nSecond avis tout à fait différent`
      expect(dropReplyMarker(one.replace(/\s+/g, ' ').toLowerCase())).toBe('premier avis détaillé ici')
      const screen = { queued: [two], sent: one } as unknown as Parameters<typeof queuedPhase>[1]
      expect(queuedPhase(one, screen)).toBe('sent')
      expect(queuedPhase(two, screen)).toBe('queued')
    }
  })
})
