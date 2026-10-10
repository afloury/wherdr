import { describe, expect, it } from 'vitest'
import { DEFAULT_QUOTE_MODE, enterAction, fieldItems, migrateQuoteMode, readField, readQuoteMode, type FieldNode } from '../app/utils/quoteTokens'

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

// A Storage stand-in over a plain record.
function store(init: Record<string, string>) {
  const data = { ...init }
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => { data[k] = v },
    removeItem: (k: string) => { delete data[k] },
  }
}

describe('quote mode saved on this device', () => {
  it('defaults to tokens in the native field', () => {
    expect(DEFAULT_QUOTE_MODE).toBe('native')
    expect(readQuoteMode(null)).toBe('native')
    expect(readQuoteMode('tokens')).toBe('native')
    expect(readQuoteMode('lines')).toBe('lines')
    expect(readQuoteMode('rich')).toBe('rich')
  })
  it('an empty storage takes the default and records the pass', () => {
    const s = store({})
    expect(migrateQuoteMode(s)).toBe('native')
    expect(s.data).toEqual({ quoteMode: 'native' })
  })
  it('the pass overwrites the former per-device values once and removes their keys', () => {
    const s = store({ quoteModeComputer: 'lines', quoteModePhone: 'rich', quoteTokensComputer: '1', quoteTokensPhone: '0', theme: 'dark' })
    expect(migrateQuoteMode(s)).toBe('native')
    expect(s.data).toEqual({ quoteMode: 'native', theme: 'dark' })
  })
  it('a choice made after the pass is kept on the next launches', () => {
    const s = store({ quoteModeComputer: 'rich' })
    migrateQuoteMode(s)
    s.setItem('quoteMode', 'lines')
    expect(migrateQuoteMode(s)).toBe('lines')
    expect(migrateQuoteMode(s)).toBe('lines')
    expect(s.data).toEqual({ quoteMode: 'lines' })
  })
})
