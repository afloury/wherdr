// terminal.mouse was added in Herdr 0.9.2. Unknown versions keep legacy input.
export function hasTerminalMouse(version: string): boolean {
  const match = /^(?:herdr\s+)?(\d+)\.(\d+)\.(\d+)(?:\b|$)/.exec(version.trim())
  if (!match) return false
  const [, major, minor, patch] = match.map(Number)
  return major! > 0 || minor! > 9 || (minor === 9 && patch! >= 2)
}

export interface TerminalMouse {
  type: 'terminal.mouse'
  action: 'down' | 'up' | 'drag' | 'move'
  button: 'left' | 'middle' | 'right'
  column: number
  row: number
  modifiers: number
}

export function cleanTerminalMouse(value: Record<string, unknown>, cols: number, rows: number): TerminalMouse | null {
  const { action, button, column, row, modifiers = 0 } = value
  if (typeof action !== 'string' || !['down', 'up', 'drag', 'move'].includes(action)
    || typeof button !== 'string' || !['left', 'middle', 'right'].includes(button)) return null
  if (typeof column !== 'number' || !Number.isInteger(column) || column < 0 || column >= cols
    || typeof row !== 'number' || !Number.isInteger(row) || row < 0 || row >= rows
    || typeof modifiers !== 'number' || !Number.isInteger(modifiers) || modifiers < 0 || modifiers > 15) return null
  return { type: 'terminal.mouse', action, button, column, row, modifiers } as TerminalMouse
}
