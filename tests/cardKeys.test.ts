import { describe, expect, it } from 'vitest'
import { cardKey, type FocusInfo } from '../app/utils/cardKeys'

const body: FocusInfo = { editable: false, empty: true, control: false, overlay: false }
const field = (text: string): FocusInfo => ({ ...body, editable: true, empty: !text })
const opts = { digits: 3, enter: true }

describe('cardKey', () => {
  it('↑ ↓ Enter Escape without focus', () => {
    expect(cardKey({ key: 'ArrowUp' }, body, opts)).toEqual({ kind: 'nav', key: 'up' })
    expect(cardKey({ key: 'ArrowDown' }, body, opts)).toEqual({ kind: 'nav', key: 'down' })
    expect(cardKey({ key: 'Enter' }, body, opts)).toEqual({ kind: 'nav', key: 'enter' })
    expect(cardKey({ key: 'Escape' }, body, opts)).toEqual({ kind: 'nav', key: 'esc' })
  })
  it('empty message field: arrows and digits captured', () => {
    expect(cardKey({ key: 'ArrowDown' }, field(''), opts)).toEqual({ kind: 'nav', key: 'down' })
    expect(cardKey({ key: 'Enter' }, field(''), opts)).toEqual({ kind: 'nav', key: 'enter' })
    expect(cardKey({ key: '1' }, field(''), opts)).toEqual({ kind: 'digit', n: 1 })
  })
  it('text being typed: nothing is stolen', () => {
    for (const key of ['ArrowUp', 'ArrowDown', 'Enter', 'Escape', '2']) expect(cardKey({ key }, field('bonjour'), opts)).toBeNull()
  })
  it('chiffres : seulement les options existantes', () => {
    expect(cardKey({ key: '3' }, body, opts)).toEqual({ kind: 'digit', n: 3 })
    expect(cardKey({ key: '4' }, body, opts)).toBeNull()
    expect(cardKey({ key: '1' }, body, { digits: 0, enter: true })).toBeNull()
  })
  it('modifiers, composition, open window: ignored', () => {
    expect(cardKey({ key: 'ArrowUp', metaKey: true }, body, opts)).toBeNull()
    expect(cardKey({ key: 'ArrowUp', shiftKey: true }, body, opts)).toBeNull()
    expect(cardKey({ key: 'Enter', isComposing: true }, body, opts)).toBeNull()
    expect(cardKey({ key: 'ArrowUp', defaultPrevented: true }, body, opts)).toBeNull()
    expect(cardKey({ key: 'ArrowUp' }, { ...body, overlay: true }, opts)).toBeNull()
  })
  it('focused button: Enter keeps its click, the arrows go through', () => {
    const btn = { ...body, control: true }
    expect(cardKey({ key: 'Enter' }, btn, opts)).toBeNull()
    expect(cardKey({ key: 'ArrowUp' }, btn, opts)).toEqual({ kind: 'nav', key: 'up' })
  })
  it('Enter refused when it is not a simple choice (/model)', () => {
    expect(cardKey({ key: 'Enter' }, body, { digits: 0, enter: false })).toBeNull()
  })
  it('card search: ↑/↓ captured even with text, Enter left to the field', () => {
    const own = { ...field('abc'), own: true }
    expect(cardKey({ key: 'ArrowDown' }, own, opts)).toEqual({ kind: 'nav', key: 'down' })
    expect(cardKey({ key: 'Enter' }, own, opts)).toBeNull()
    expect(cardKey({ key: 'Escape' }, own, opts)).toBeNull()
    expect(cardKey({ key: '1' }, { ...field(''), own: true }, opts)).toBeNull()
  })
})
