import { describe, expect, it } from 'vitest'
import { cellFocusStep, cellMode, paneFallback, showComposer, spaceTabControls, terminalAttachment, toggleViewMode, viewControls } from '../app/utils/viewMode'

const base = { desk: false, cell: false, chat: true, live: true, project: false }

describe('viewControls', () => {
  it('phone: terminal toggle in the header, no selector', () => {
    expect(viewControls(base)).toEqual({ selector: null, term: true, project: false })
  })
  it('phone, coordinator: Project toggle as well', () => {
    expect(viewControls({ ...base, project: true })).toEqual({ selector: null, term: true, project: true })
  })
  it('computer: selector in the header, or in the cell header', () => {
    expect(viewControls({ ...base, desk: true, project: true })).toEqual({ selector: 'header', term: false, project: false })
    expect(viewControls({ ...base, desk: true, cell: true })).toEqual({ selector: 'cell', term: false, project: false })
  })
  it('agent sans conversation : aucune commande', () => {
    const none = { selector: null, term: false, project: false }
    expect(viewControls({ ...base, chat: false, project: true })).toEqual(none)
    expect(viewControls({ ...base, desk: true, chat: false })).toEqual(none)
    expect(viewControls({ ...base, desk: true, cell: true, chat: false, live: false })).toEqual(none)
  })
  it('cell without the focus: keeps its selector', () => {
    expect(viewControls({ ...base, desk: true, cell: true, live: false })).toEqual({ selector: 'cell', term: false, project: false })
  })
})

describe('saisie du pane', () => {
  it('removes the field on a computer in the terminal', () => {
    const mode = 'term'
    expect(showComposer({ desk: true, live: true, mode })).toBe(false)
    expect(terminalAttachment({ desk: true, live: true, mode, available: true })).toBe(true)
    expect(showComposer({ desk: false, live: true, mode })).toBe(true)
    expect(terminalAttachment({ desk: false, live: true, mode, available: true })).toBe(false)
  })
  it('keeps the field in the conversation on both devices', () => {
    expect(showComposer({ desk: true, live: true, mode: 'chat' })).toBe(true)
    expect(showComposer({ desk: false, live: true, mode: 'chat' })).toBe(true)
    expect(terminalAttachment({ desk: true, live: true, mode: 'chat', available: true })).toBe(false)
  })
  it('keeps the field of a conversation cell without the focus', () => {
    expect(showComposer({ desk: true, live: false, mode: 'chat', cell: true })).toBe(true)
    expect(showComposer({ desk: true, live: false, mode: 'term', cell: true })).toBe(false)
    expect(showComposer({ desk: true, live: false, mode: 'chat' })).toBe(false)
  })
  it('offers nothing in an inactive or offline cell', () => {
    expect(showComposer({ desk: true, live: false, mode: 'term' })).toBe(false)
    expect(terminalAttachment({ desk: true, live: false, mode: 'term', available: true })).toBe(false)
    expect(terminalAttachment({ desk: true, live: true, mode: 'term', available: false })).toBe(false)
  })
})

describe('spaceTabControls', () => {
  it('puts the + in the header for a single tab', () => {
    expect(spaceTabControls(1)).toEqual({ row: false, headerAdd: true })
  })
  it('puts the row and its + before the header for several tabs', () => {
    expect(spaceTabControls(2)).toEqual({ row: true, headerAdd: false })
    expect(spaceTabControls(3)).toEqual({ row: true, headerAdd: false })
  })
  it('waits for the space state before showing controls', () => {
    expect(spaceTabControls(0)).toEqual({ row: false, headerAdd: false })
  })
})

describe('toggleViewMode', () => {
  it('shows the target, then goes back to the conversation', () => {
    expect(toggleViewMode('chat', 'term')).toBe('term')
    expect(toggleViewMode('term', 'term')).toBe('chat')
    expect(toggleViewMode('project', 'term')).toBe('term')
    expect(toggleViewMode('term', 'project')).toBe('project')
    expect(toggleViewMode('project', 'project')).toBe('chat')
  })
})

describe('cellMode', () => {
  it('keeps the pane\'s remembered mode, focused or not', () => {
    expect(cellMode({ chat: true, viewMode: 'term' })).toBe('term')
    expect(cellMode({ chat: true, viewMode: 'chat' })).toBe('chat')
    expect(cellMode({ chat: true, viewMode: 'project' })).toBe('chat')
    expect(cellMode({ chat: true, viewMode: 'chat', active: true })).toBe('chat')
  })
  it('without a conversation: always the terminal', () => {
    expect(cellMode({ chat: false, viewMode: 'chat' })).toBe('term')
    expect(cellMode({ chat: false, viewMode: 'chat', active: true })).toBe('term')
  })
  it('keeps all terminals live through focus changes', () => {
    const modes: Record<string, 'chat' | 'term'> = { a: 'term', b: 'term', c: 'chat' }
    const show = (focus: string) => Object.fromEntries(Object.entries(modes).map(([k, m]) => [k, cellMode({ chat: true, viewMode: m, active: k === focus })]))
    expect(show('a')).toEqual({ a: 'term', b: 'term', c: 'chat' })
    expect(show('b')).toEqual({ a: 'term', b: 'term', c: 'chat' })
    // Focusing a conversation also preserves the terminal presentations.
    expect(show('c')).toEqual({ a: 'term', b: 'term', c: 'chat' })
  })
})

describe('paneFallback', () => {
  // A pane without an explicit choice: the device default on a computer,
  // the conversation on the phone.
  it('computer: the device default is used', () => {
    expect(paneFallback({ defaultMode: 'term', desk: true })).toBe('term')
    expect(paneFallback({ defaultMode: 'chat', desk: true })).toBe('chat')
  })
  it('phone: always the conversation', () => {
    expect(paneFallback({ defaultMode: 'term', desk: false })).toBe('chat')
  })
})

describe('cellFocusStep', () => {
  const k = (key: string, o: Partial<{ altKey: boolean, ctrlKey: boolean, metaKey: boolean, shiftKey: boolean }> = {}) =>
    cellFocusStep({ key, altKey: true, ctrlKey: true, metaKey: false, shiftKey: false, ...o })
  it('Ctrl/⌘ + Alt + arrow: previous or next cell', () => {
    expect(k('ArrowLeft')).toBe(-1)
    expect(k('ArrowUp')).toBe(-1)
    expect(k('ArrowRight')).toBe(1)
    expect(k('ArrowDown', { ctrlKey: false, metaKey: true })).toBe(1)
  })
  it('ignores the other combinations (Alt + Shift + arrow swaps panes)', () => {
    expect(k('ArrowLeft', { shiftKey: true })).toBe(0)
    expect(k('ArrowLeft', { ctrlKey: false })).toBe(0)
    expect(k('ArrowLeft', { altKey: false })).toBe(0)
    expect(k('Tab')).toBe(0)
  })
})
