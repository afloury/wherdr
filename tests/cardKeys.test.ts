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
  it('digits by position on AZERTY outside a field, never a character being typed', () => {
    expect(cardKey({ key: '&', code: 'Digit1' }, body, opts)).toEqual({ kind: 'digit', n: 1 })
    expect(cardKey({ key: 'é', code: 'Digit2' }, { ...body, control: true }, opts)).toEqual({ kind: 'digit', n: 2 })
    // Empty message field: é, ', ( start a reply; Shift+digit still picks.
    expect(cardKey({ key: 'é', code: 'Digit2' }, field(''), opts)).toBeNull()
    expect(cardKey({ key: '1', code: 'Digit1', shiftKey: true }, field(''), opts)).toEqual({ kind: 'digit', n: 1 })
    expect(cardKey({ key: '!', code: 'Digit1', shiftKey: true }, body, opts)).toBeNull()
    expect(cardKey({ key: '\'', code: 'Digit4' }, body, opts)).toBeNull()
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
  it('←/→: only on a card with tabs, and never on text being typed', () => {
    const tabs = { ...opts, tabs: true }
    expect(cardKey({ key: 'ArrowLeft' }, body, opts)).toBeNull()
    expect(cardKey({ key: 'ArrowRight' }, field(''), tabs)).toEqual({ kind: 'tab', dir: 1 })
    expect(cardKey({ key: 'ArrowLeft' }, body, tabs)).toEqual({ kind: 'tab', dir: -1 })
    expect(cardKey({ key: 'ArrowLeft' }, field('bonjour'), tabs)).toBeNull()
    expect(cardKey({ key: 'ArrowRight', shiftKey: true }, body, tabs)).toBeNull()
  })
  it('Ctrl+A of a menu legend: captured outside a field with text, ⌘A left alone', () => {
    const menu = { digits: 0, enter: true, ctrl: ['ctrl+a', 'ctrl+b'] }
    expect(cardKey({ key: 'a', ctrlKey: true }, body, menu)).toEqual({ kind: 'ctrl', key: 'ctrl+a' })
    expect(cardKey({ key: 'a', ctrlKey: true }, field(''), menu)).toEqual({ kind: 'ctrl', key: 'ctrl+a' })
    expect(cardKey({ key: 'a', ctrlKey: true }, { ...body, control: true }, menu)).toEqual({ kind: 'ctrl', key: 'ctrl+a' })
    // Caps Lock: same key.
    expect(cardKey({ key: 'A', ctrlKey: true }, body, menu)).toEqual({ kind: 'ctrl', key: 'ctrl+a' })
    expect(cardKey({ key: 'b', ctrlKey: true }, body, menu)).toEqual({ kind: 'ctrl', key: 'ctrl+b' })
    // Text in a field (select all), the terminal (sends it itself), a window on top.
    expect(cardKey({ key: 'a', ctrlKey: true }, field('bonjour'), menu)).toBeNull()
    expect(cardKey({ key: 'a', ctrlKey: true }, { ...field('abc'), own: true }, menu)).toBeNull()
    expect(cardKey({ key: 'a', ctrlKey: true }, { ...field(''), terminal: true }, menu)).toBeNull()
    expect(cardKey({ key: 'a', ctrlKey: true }, { ...body, overlay: true }, menu)).toBeNull()
    // ⌘A (select all on macOS) and other modifiers.
    expect(cardKey({ key: 'a', metaKey: true }, body, menu)).toBeNull()
    expect(cardKey({ key: 'a', ctrlKey: true, metaKey: true }, body, menu)).toBeNull()
    expect(cardKey({ key: 'a', ctrlKey: true, shiftKey: true }, body, menu)).toBeNull()
    expect(cardKey({ key: 'a', ctrlKey: true, altKey: true }, body, menu)).toBeNull()
    // Only the keys the card offers; never a key the browser keeps.
    expect(cardKey({ key: 'a', ctrlKey: true }, body, opts)).toBeNull()
    expect(cardKey({ key: 'c', ctrlKey: true }, body, menu)).toBeNull()
    expect(cardKey({ key: 'w', ctrlKey: true }, body, { ...menu, ctrl: ['ctrl+w'] })).toBeNull()
    expect(cardKey({ key: 'ArrowUp', ctrlKey: true }, body, menu)).toBeNull()
  })
  it('menu with no entry: only its Ctrl+letters are captured', () => {
    const empty = { digits: 0, enter: true, ctrl: ['ctrl+a'], nav: false }
    expect(cardKey({ key: 'a', ctrlKey: true }, body, empty)).toEqual({ kind: 'ctrl', key: 'ctrl+a' })
    for (const key of ['ArrowUp', 'ArrowDown', 'Enter', 'Escape']) expect(cardKey({ key }, body, empty)).toBeNull()
  })
})
