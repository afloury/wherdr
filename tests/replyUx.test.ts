import { describe, expect, it } from 'vitest'
import { addRef, composeReplies, moveRef, removeRef, replyRefs } from '../app/utils/replyUx'

const ref = (text: string, answer = '') => ({ text, answer })

describe('composeReplies', () => {
  it('puts each quote above its answer, pairs apart, general word last', () => {
    expect(composeReplies([
      ref('Tu aimes les pommes ?', 'Oui.'),
      ref("j'ai une télé", 'Quel modèle de télé as-tu ?'),
      ref('Quelle est ta série préférée ?', "J'adore Lost !"),
    ], 'Bonne journée.')).toBe(
      "> Tu aimes les pommes ?\nOui.\n\n> j'ai une télé\nQuel modèle de télé as-tu ?\n\n> Quelle est ta série préférée ?\nJ'adore Lost !\n\nBonne journée.",
    )
  })
  it('makes the main field the answer of a single quote left without one', () => {
    expect(composeReplies([ref("j'ai une télé")], 'Quel modèle ?')).toBe("> j'ai une télé\nQuel modèle ?")
  })
  it('keeps an unanswered quote and sends the text alone without references', () => {
    expect(composeReplies([ref('Une ?', 'Oui.'), ref('Deux ?')], '')).toBe('> Une ?\nOui.\n\n> Deux ?')
    expect(composeReplies([], '  Salut  ')).toBe('Salut')
  })
  it('quotes a multi-line passage line by line', () => {
    expect(composeReplies([ref('Ligne un\nLigne deux', 'Vu.')], '')).toBe('> Ligne un\n> Ligne deux\nVu.')
  })
})

describe('references', () => {
  it('never adds the same passage twice and keeps the order editable', () => {
    const pane = 'test-pane'
    const a = addRef(pane, 'Tu aimes les pommes ?', 'question')!
    expect(addRef(pane, '  tu aimes   les pommes ? ', 'question')).toBe(a)
    const b = addRef(pane, "j'ai une télé", 'passage')!
    moveRef(pane, b.id, -1)
    expect(replyRefs(pane).map(r => r.text)).toEqual(["j'ai une télé", 'Tu aimes les pommes ?'])
    moveRef(pane, b.id, -1)
    expect(replyRefs(pane)[0]).toBe(b)
    removeRef(pane, b.id)
    expect(replyRefs(pane)).toEqual([a])
  })
})
