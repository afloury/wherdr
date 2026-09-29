import { describe, expect, it } from 'vitest'
import { parseReply, replyTarget, withReply } from '../shared/replyQuote'
import { queuedPhases } from '../shared/queuedPhase'
import { selectionReplyPos } from '../app/utils/selectionReply'
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
  it('bouton au coin inférieur droit de la sélection', () => {
    const view = { width: 1440, top: 100, bottom: 900 }
    expect(selectionReplyPos({ top: 300, bottom: 320, left: 100, right: 400 }, { width: 100, height: 32 }, view, false)).toEqual({ top: 328, left: 300 })
    expect(selectionReplyPos({ top: 300, bottom: 320, left: 0, right: 40 }, { width: 100, height: 32 }, view, true)!.left).toBe(8)
    expect(selectionReplyPos({ top: 300, bottom: 320, left: 1300, right: 1440 }, { width: 100, height: 32 }, view, false)!.left).toBe(1332)
  })
  it('sans place dessous : au-dessus ; hors écran : pas de bouton', () => {
    const view = { width: 1440, top: 100, bottom: 900 }
    expect(selectionReplyPos({ top: 800, bottom: 880, left: 100, right: 400 }, { width: 100, height: 32 }, view, false)!.top).toBe(760)
    expect(selectionReplyPos({ top: 950, bottom: 970, left: 1, right: 2 }, { width: 100, height: 32 }, view, false)).toBeNull()
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
