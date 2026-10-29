import { describe, expect, it } from 'vitest'
import { toggleVirtualModifier, virtualChord, virtualInputKey } from '../app/utils/terminalModifiers'

describe('one-shot terminal modifiers', () => {
  it('stacks and toggles modifiers without duplicates', () => {
    expect(toggleVirtualModifier(['ctrl'], 'shift')).toEqual(['ctrl', 'shift'])
    expect(toggleVirtualModifier(['ctrl', 'shift'], 'ctrl')).toEqual(['shift'])
    expect(virtualChord('shift+tab', ['ctrl', 'shift'])).toBe('ctrl+shift+tab')
    expect(virtualChord('left', ['shift'])).toBe('shift+left')
    expect(virtualChord('+', ['alt'])).toBe('alt+plus')
  })
  it('recognizes single ASCII and named input without converting composed text or pastes', () => {
    expect(virtualInputKey('C')).toBe('c')
    expect(virtualInputKey('\x03')).toBe('ctrl+c')
    expect(virtualInputKey('\x1b[D')).toBe('left')
    expect(virtualInputKey('\r')).toBe('enter')
    expect(virtualInputKey('你好')).toBeNull()
    expect(virtualInputKey('é')).toBeNull()
    expect(virtualInputKey('hello')).toBeNull()
    expect(virtualInputKey('\x1b[200~hello\x1b[201~')).toBeNull()
  })
})
