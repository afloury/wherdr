import { describe, expect, it } from 'vitest'
import { dropReplyMarker, findReplyOrigin, MARKER_MAX, parseReply, plainText, replyMarker, replyTarget, truncate, withReply } from '../shared/replyQuote'
import { restoreDraft } from '../app/utils/queuedCancel'
import { queuedPhase } from '../shared/queuedPhase'

const LONG = 'Je propose deux options : **garder** le cache actuel et le borner à 50 Mo, ou le remplacer par IndexedDB avec une purge au démarrage. La seconde est plus propre mais plus longue.'

describe('repère de réponse', () => {
  it('construit un repère court en français et en anglais', () => {
    const r = replyTarget('Je propose deux options : A ou B.', '14:32', 'fr')
    expect(replyMarker(r, 'fr')).toBe('↳ En réponse à ton message de 14:32 (« Je propose deux options : A ou B. »)')
    expect(replyMarker(replyTarget('Two options: A or B.', '2:32 PM', 'en'), 'en')).toBe('↳ Replying to your message from 2:32 PM ("Two options: A or B.")')
  })

  it('tronque un long message sans dépasser ~120 caractères', () => {
    for (const lang of ['fr', 'en'] as const) {
      const r = replyTarget(LONG, '14:32', lang)
      expect(r.excerpt.endsWith('…')).toBe(true)
      expect(r.excerpt).not.toContain('**')
      expect(replyMarker(r, lang).length).toBeLessThanOrEqual(MARKER_MAX)
    }
  })

  it('préfère le passage sélectionné au début du message', () => {
    const r = replyTarget(LONG, '09:05', 'fr', '  la seconde est plus propre ')
    expect(r.excerpt).toBe('la seconde est plus propre')
  })

  it('met le repère devant la réponse, séparé par une ligne vide', () => {
    const r = replyTarget('Option A ?', '14:32', 'fr')
    expect(withReply(r, 'Oui, A.', 'fr')).toBe('↳ En réponse à ton message de 14:32 (« Option A ? »)\n\nOui, A.')
    expect(withReply(null, 'Oui', 'fr')).toBe('Oui')
  })

  it('nettoie le markdown et coupe sur un mot', () => {
    expect(plainText('## Titre\n- `code` et [lien](http://x)')).toBe('Titre code et lien')
    expect(truncate('un deux trois quatre', 15)).toBe('un deux trois…')
  })
})

describe('affichage d’une réponse', () => {
  it('reconnaît le repère (deux langues) et rend le corps', () => {
    const text = withReply(replyTarget(LONG, '14:32', 'fr'), 'Plutôt la seconde.\nMerci', 'fr')
    const p = parseReply(text)!
    expect(p.reply.time).toBe('14:32')
    expect(p.reply.excerpt.startsWith('Je propose deux options')).toBe(true)
    expect(p.body).toBe('Plutôt la seconde.\nMerci')
    expect(parseReply(withReply(replyTarget('Two options', '2:32 PM', 'en'), 'B', 'en'))!.body).toBe('B')
    expect(parseReply('Un message ordinaire')).toBeNull()
    expect(parseReply('↳ autre chose')).toBeNull()
  })

  it('retrouve le message d’origine par l’heure et le début du texte', () => {
    const list = [
      { key: 'a', time: '14:30', text: 'Je propose deux options : A.' },
      { key: 'b', time: '14:32', text: LONG },
      { key: 'c', time: '14:32', text: 'Autre chose' },
    ]
    expect(findReplyOrigin(list, replyTarget(LONG, '14:32', 'fr'))?.key).toBe('b')
    // Passage sélectionné au milieu du message.
    expect(findReplyOrigin(list, replyTarget(LONG, '14:32', 'fr', 'La seconde est plus propre'))?.key).toBe('b')
    // Heure différente (autre fuseau) : l'extrait suffit.
    expect(findReplyOrigin(list, { time: '16:32', excerpt: 'Autre chose' })?.key).toBe('c')
    expect(findReplyOrigin(list, { time: '10:00', excerpt: 'introuvable' })).toBeNull()
  })

  it('remet l’encadré de réponse dans le brouillon à l’annulation d’un message en file', () => {
    const d = { text: '', atts: [], reply: null } as Parameters<typeof restoreDraft>[0]
    restoreDraft(d, withReply({ time: '14:32', excerpt: 'Option A ?' }, 'Oui', 'fr'))
    expect(d.reply).toEqual({ time: '14:32', excerpt: 'Option A ?' })
    expect(d.text).toBe('Oui')
  })

  it('ne confond pas deux réponses au même message dans la file', () => {
    const r = { time: '14:32', excerpt: 'Je propose deux options : garder le cache actuel et le borner à 50 Mo…' }
    const one = withReply(r, 'Premier avis détaillé ici', 'fr')
    const two = withReply(r, 'Second avis tout à fait différent', 'fr')
    expect(dropReplyMarker(one.replace(/\s+/g, ' ').toLowerCase())).toBe('premier avis détaillé ici')
    const screen = { queued: [two], sent: one } as unknown as Parameters<typeof queuedPhase>[1]
    expect(queuedPhase(one, screen)).toBe('sent')
    expect(queuedPhase(two, screen)).toBe('queued')
  })
})
