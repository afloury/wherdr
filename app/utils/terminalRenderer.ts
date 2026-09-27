export type TerminalRenderer = 'webgl' | 'html'
export type ActiveTerminalRenderer = 'webgl' | 'html' | 'html-fallback'

export function parseTerminalRenderer(value: string | null): TerminalRenderer {
  return value === 'html' ? 'html' : 'webgl'
}

export function activeTerminalRenderer(choice: TerminalRenderer, webglAvailable: boolean): ActiveTerminalRenderer {
  return choice === 'html' ? 'html' : webglAvailable ? 'webgl' : 'html-fallback'
}
