export const VIRTUAL_MODIFIERS = ['ctrl', 'alt', 'shift'] as const
export type VirtualModifier = typeof VIRTUAL_MODIFIERS[number]

export function toggleVirtualModifier(current: readonly VirtualModifier[], modifier: VirtualModifier): VirtualModifier[] {
  return current.includes(modifier) ? current.filter(m => m !== modifier) : [...current, modifier]
}

export function virtualChord(key: string, modifiers: readonly VirtualModifier[]): string {
  const parts = (key === '+' ? 'plus' : key).toLowerCase().split('+')
  const base = parts.pop()!
  const selected = new Set([...modifiers, ...parts])
  return [...VIRTUAL_MODIFIERS.filter(m => selected.has(m)), base].join('+')
}

const INPUT_KEYS: Record<string, string> = {
  '\r': 'enter', '\n': 'enter', '\t': 'tab', '\x1b': 'esc', '\x7f': 'backspace', '\b': 'backspace', ' ': 'space',
  '\x1b[A': 'up', '\x1b[B': 'down', '\x1b[C': 'right', '\x1b[D': 'left',
  '\x1bOA': 'up', '\x1bOB': 'down', '\x1bOC': 'right', '\x1bOD': 'left', '\x1b[Z': 'shift+tab',
}

// Android IMEs may emit text without KeyboardEvents. Only a single ASCII
// key or a recognized terminal key can consume an armed modifier. Composed
// text and pastes remain text, never a sequence of shortcuts.
export function virtualInputKey(data: string): string | null {
  if (Object.hasOwn(INPUT_KEYS, data)) return INPUT_KEYS[data]!
  if (/^[!-~]$/.test(data)) return data === '+' ? 'plus' : data.toLowerCase()
  if (data.length === 1) {
    const code = data.charCodeAt(0)
    if (code === 0) return 'ctrl+space'
    if (code >= 1 && code <= 26) return `ctrl+${String.fromCharCode(code + 96)}`
  }
  return null
}
