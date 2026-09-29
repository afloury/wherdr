import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { findReplyOrigin, MARKER_MAX, parseReply, replyMarker, replyTarget, withReply } from '../shared/replyQuote'
import { queuedPhases } from '../shared/queuedPhase'
import { createSelectionSettler, lastLineRect, trimmedEnd, selectionReplyPos, SETTLE_KEYBOARD, SETTLE_POINTER, SETTLE_SCROLL, SETTLE_TOUCH } from '../app/utils/selectionReply'
import type { ClaudeScreen } from '../shared/types'

const MSG = 'Je propose deux options : garder le cache actuel, ou passer à IndexedDB avec une purge au démarrage.'
const screen = (sent: string | null, queued: string[] = []) => ({ shell: null, sent, queued }) as ClaudeScreen

describe('répondre à une sélection', () => {
  it('la sélection donne un repère « passage »', () => {
    const r = replyTarget(MSG, '14:32', 'fr', ' passer à IndexedDB ')
    expect(r).toEqual({ time: '14:32', excerpt: 'passer à IndexedDB', part: true })
  })
  it('le bouton sous le message répond au message entier', () => {
    const r = replyTarget(MSG, '14:32', 'fr')
    expect(r.part).toBeUndefined()
    expect(r.excerpt.startsWith('Je propose deux options')).toBe(true)
  })
  const view = { width: 1440, top: 100, bottom: 900 }
  const btn = { width: 100, height: 32 }
  it('bouton juste après le dernier caractère, centré sur sa ligne', () => {
    expect(selectionReplyPos({ top: 300, bottom: 320, left: 100, right: 400 }, btn, view, false)).toEqual({ top: 294, left: 406 })
  })
  it('dernière ligne = dernier rectangle non vide', () => {
    const rects = [{ top: 280, bottom: 300, left: 100, right: 900 }, { top: 300, bottom: 320, left: 100, right: 260 }, { top: 320, bottom: 320, left: 100, right: 100 }]
    expect(lastLineRect(rects)).toEqual(rects[1])
    expect(lastLineRect([])).toBeNull()
  })
  it('fin rognée : saut de ligne final d’un triple-clic', () => {
    expect(trimmedEnd(['Dernier paragraphe complet.\n'])).toEqual({ index: 0, offset: 27 })
  })
  it('fin rognée : nœuds blancs après le paragraphe (pied, message suivant rognés)', () => {
    expect(trimmedEnd(['Début ', 'fin du message.', '\n\n', '  '])).toEqual({ index: 1, offset: 15 })
    expect(trimmedEnd(['\n', ' '])).toBeNull()
    expect(trimmedEnd([])).toBeNull()
  })
  it('fin rognée : emoji final entier', () => {
    expect(trimmedEnd(['ok 👍\n'])).toEqual({ index: 0, offset: 5 })
  })
  it('rectangles vides de fin ignorés', () => {
    const rects = [{ top: 300, bottom: 320, left: 100, right: 500 }, { top: 320, bottom: 340, left: 100, right: 100 }, { top: 340, bottom: 340, left: 0, right: 0 }]
    expect(lastLineRect(rects)).toEqual(rects[0])
  })
  it('débordement à droite : sous la fin de la ligne, aligné sur le dernier mot', () => {
    expect(selectionReplyPos({ top: 300, bottom: 320, left: 1200, right: 1400 }, btn, view, false)).toEqual({ top: 326, left: 1300 })
    expect(selectionReplyPos({ top: 300, bottom: 320, left: 1300, right: 1440 }, btn, view, false)!.left).toBe(1332)
  })
  it('téléphone : sous la ligne, sous la poignée, jamais au-dessus', () => {
    expect(selectionReplyPos({ top: 300, bottom: 320, left: 0, right: 40 }, btn, { width: 390, top: 0, bottom: 800 }, true)).toEqual({ top: 342, left: 8 })
    expect(selectionReplyPos({ top: 760, bottom: 780, left: 0, right: 200 }, btn, { width: 390, top: 0, bottom: 800 }, true)!.top).toBe(760)
  })
  it('sans place dessous : au-dessus ; hors écran : pas de bouton', () => {
    expect(selectionReplyPos({ top: 860, bottom: 880, left: 1200, right: 1400 }, btn, view, false)!.top).toBe(822)
    expect(selectionReplyPos({ top: 950, bottom: 970, left: 1, right: 2 }, btn, view, false)).toBeNull()
  })
  it('sélection inversée : même rectangle de fin, même place', () => {
    // getClientRects() suit l'ordre du document quel que soit le sens du glissé.
    const rects = [{ top: 280, bottom: 300, left: 300, right: 900 }, { top: 300, bottom: 320, left: 100, right: 400 }]
    expect(selectionReplyPos(lastLineRect(rects)!, btn, view, false)).toEqual({ top: 294, left: 406 })
  })
})

describe('répondre à une sélection : apparition', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  const make = (touch = false) => {
    const show = vi.fn(), hide = vi.fn()
    return { show, hide, s: createSelectionSettler({ show, hide, touch: () => touch }) }
  }
  it('jamais pendant le glissé, après le relâchement + délai', () => {
    const { show, s } = make()
    s.down(); s.change(); s.change()
    vi.advanceTimersByTime(1000)
    expect(show).not.toHaveBeenCalled()
    s.up()
    vi.advanceTimersByTime(SETTLE_POINTER - 1)
    expect(show).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(show).toHaveBeenCalledOnce()
  })
  it('clavier : après un délai sans changement', () => {
    const { show, hide, s } = make()
    s.change(); vi.advanceTimersByTime(200); s.change()
    expect(hide).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(SETTLE_KEYBOARD - 1)
    expect(show).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(show).toHaveBeenCalledOnce()
  })
  it('évènement parasite sans changement : pas de clignotement', () => {
    const { hide, s } = make()
    s.change(true)
    expect(hide).not.toHaveBeenCalled()
  })
  it('téléphone : attend la fin de l’ajustement des poignées', () => {
    const { show, s } = make(true)
    s.change(); vi.advanceTimersByTime(SETTLE_TOUCH - 50); s.change()
    vi.advanceTimersByTime(SETTLE_TOUCH - 1)
    expect(show).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(show).toHaveBeenCalledOnce()
  })
  it('défilement : caché, puis réaffiché une fois arrêté', () => {
    const { show, hide, s } = make()
    s.scroll(); vi.advanceTimersByTime(100); s.scroll()
    expect(hide).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(SETTLE_SCROLL)
    expect(show).toHaveBeenCalledOnce()
  })
})

describe('file d’attente : ordre d’envoi', () => {
  it('le 2e ne passe pas « envoyé » avant le 1er', () => {
    // Claude a pris les deux messages ; l'écran ne montre que le dernier parti.
    expect(queuedPhases(['Premier message assez long pour compter', 'Second message'], screen('Second message'))).toEqual(['sent', 'sent'])
  })
  it('un plus ancien encore dans la file retient les suivants', () => {
    expect(queuedPhases(['Premier', 'Second'], screen('Second', ['Premier']))).toEqual(['queued', 'queued'])
  })
  it('ordre normal inchangé', () => {
    expect(queuedPhases(['Premier', 'Second'], screen('Premier', ['Second']))).toEqual(['sent', 'queued'])
    expect(queuedPhases(['Premier', 'Second'], null)).toEqual(['queued', 'queued'])
  })
})

describe('file d’attente : citation', () => {
  it('la bulle en file garde sa citation', () => {
    const msg = withReply(replyTarget(MSG, '14:32', 'fr', 'passer à IndexedDB'), 'Yes please', 'fr')
    expect(parseReply(msg)).toEqual({ reply: { time: '14:32', excerpt: 'passer à IndexedDB' }, body: 'Yes please' })
  })
})

describe('repère d’une longue sélection : début et fin', () => {
  const long = 'Premier point important sur le cache actuel, puis une longue explication intermédiaire qui ne tient pas du tout dans le repère, et enfin la conclusion qui recommande IndexedDB.'
  it('extrait « début… fin », coupé aux mots, repère ≤ MARKER_MAX', () => {
    for (const lang of ['fr', 'en'] as const) {
      const r = replyTarget('x', '14:32', lang, long)
      expect(r.part).toBe(true)
      expect(r.excerpt.startsWith('Premier point')).toBe(true)
      expect(r.excerpt.endsWith('recommande IndexedDB.')).toBe(true)
      expect(r.excerpt).toMatch(/^\S.*\S… \S.*\S$/)
      const [a, b] = r.excerpt.split('… ')
      expect(long.startsWith(a!)).toBe(true)
      expect(long.endsWith(b!)).toBe(true)
      expect(Math.abs(a!.length - b!.length)).toBeLessThan(15)
      expect(replyMarker(r, lang).length).toBeLessThanOrEqual(MARKER_MAX)
    }
  })
  it('sélection courte et message entier inchangés', () => {
    expect(replyTarget(MSG, '14:32', 'fr', 'passer à IndexedDB').excerpt).toBe('passer à IndexedDB')
    expect(replyTarget(long, '14:32', 'fr').excerpt).toMatch(/^Premier point.*…$/)
  })
  it('parseReply et findReplyOrigin : nouveau et ancien format', () => {
    const list = [{ time: '14:32', text: MSG }, { time: '14:32', text: long }]
    const r = replyTarget('x', '14:32', 'fr', long)
    const p = parseReply(withReply(r, 'ok', 'fr'))!
    expect(p.reply.excerpt).toBe(r.excerpt)
    expect(p.body).toBe('ok')
    expect(findReplyOrigin(list, p.reply)).toBe(list[1])
    expect(findReplyOrigin(list, { time: '14:32', excerpt: 'Premier point important sur le cache…' })).toBe(list[1])
  })
})
