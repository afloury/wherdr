import { describe, expect, it } from 'vitest'
import { enterAction, fieldItems, readField, readQuoteMode, type FieldNode } from '../app/utils/quoteTokens'

// Minimal DOM: elements, text nodes and tokens (data-q).
type Fake = FieldNode & { q?: string }
const txt = (data: string): Fake => ({ nodeType: 3, nodeName: '#text', data, childNodes: [] })
const el = (nodeName: string, ...childNodes: Fake[]): Fake => ({ nodeType: 1, nodeName, childNodes })
const tok = (q: string): Fake => ({ nodeType: 1, nodeName: 'SPAN', q, childNodes: [txt('↳'), txt(q.replace(/\n/g, ' ')), el('BUTTON', txt('✕'))] })
const br = () => el('BR')
const read = (...children: Fake[]) => readField(el('DIV', ...children), n => (n as Fake).q ?? null)

// The field as QuoteTokensField draws it from a draft.
function drawn(draft: string): Fake[] {
  const items = fieldItems(draft)
  const nodes = items.map(it => (it.kind === 'token' ? tok(it.text) : el('DIV', it.text ? txt(it.text) : br())))
  if (items.at(-1)?.kind === 'token') nodes.push(el('DIV', br()))
  return nodes
}

describe('quote token field', () => {
  it('reads back the draft it was drawn from', () => {
    for (const draft of [
      "> Tu aimes les pommes ?\nOui.\n> j'ai une télé\nQuel modèle ?\n\nBonne journée.",
      '> Ligne un\n> Ligne deux\nVu.',
      'Avant\n> Une question ?\nRéponse',
      '> Seule citation\n',
      'Pas de citation\n\nDeux paragraphes',
    ]) expect(read(...drawn(draft))).toBe(draft)
  })
  it('keeps one token per run of quote lines', () => {
    expect(fieldItems('> a\n> b\nok\n> c')).toEqual([{ kind: 'token', text: 'a\nb' }, { kind: 'line', text: 'ok' }, { kind: 'token', text: 'c' }])
  })
  it('reads what the browser makes of typing: new lines, Shift+Enter, text at the root', () => {
    // Enter after "Oui." in the line under a token: a new <div>.
    expect(read(tok('Q ?'), el('DIV', txt('Oui.')), el('DIV', txt('Et toi ?')))).toBe('> Q ?\nOui.\nEt toi ?')
    // Shift+Enter: a <br> inside the line; the <br> ending a line only gives it its height.
    expect(read(tok('Q ?'), el('DIV', txt('a'), br(), txt('b'), br()))).toBe('> Q ?\na\nb')
    // An empty line is a <div><br></div>.
    expect(read(tok('Q ?'), el('DIV', br()), el('DIV', txt('x')))).toBe('> Q ?\n\nx')
    // Text typed right at the root, next to a token.
    expect(read(txt('Salut'), tok('Q ?'), txt('Oui'))).toBe('Salut\n> Q ?\nOui')
    // A token deleted: its answer stays.
    expect(read(el('DIV', txt('Oui.')))).toBe('Oui.')
  })
  it('keeps plain text only, whatever the inline markup', () => {
    expect(read(tok('Q'), el('DIV', el('SPAN', txt('a ')), el('B', txt('gras'))))).toBe('> Q\na gras')
  })
})

describe('Enter in the token field', () => {
  const key = (o: Partial<{ key: string, shiftKey: boolean, isComposing: boolean }>) => ({ key: 'Enter', shiftKey: false, isComposing: false, ...o })
  it('sends like the plain field where Enter sends', () => {
    expect(enterAction(key({}), true)).toBe('send')
  })
  it('adds a line on Shift+Enter, during a composition, and on touch keyboards', () => {
    expect(enterAction(key({ shiftKey: true }), true)).toBe('newline')
    expect(enterAction(key({ isComposing: true }), true)).toBe('newline')
    expect(enterAction(key({}), false)).toBe('newline')
  })
  it('leaves other keys alone', () => {
    expect(enterAction(key({ key: 'a' }), true)).toBeNull()
  })
})

describe('quote mode saved on this device', () => {
  it('keeps a saved mode', () => {
    expect(readQuoteMode('native', '1')).toBe('native')
    expect(readQuoteMode('lines', '1')).toBe('lines')
    expect(readQuoteMode('rich', null)).toBe('rich')
  })
  it('turns the former switch on into the rich field, anything else into "> " lines', () => {
    expect(readQuoteMode(null, '1')).toBe('rich')
    expect(readQuoteMode(null, '0')).toBe('lines')
    expect(readQuoteMode(null, null)).toBe('lines')
    expect(readQuoteMode('tokens', '0')).toBe('lines')
  })
})
