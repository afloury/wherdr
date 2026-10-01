// Shift+Enter in an xterm.js terminal: xterm sends "\r", like Enter,
// and the agent confirms instead of starting a new line. We pass the named key to
// Herdr, which encodes it according to the program's mode (kitty keyboard protocol,
// otherwise modifyOtherKeys), as from a real terminal.
import type { Terminal } from '@xterm/xterm'

// `send` receives the named key; xterm emits nothing for this keystroke.
export function bindShiftEnter(term: Terminal, send: (key: 'shift+enter') => void) {
  term.attachCustomKeyEventHandler((e) => {
    if (e.key !== 'Enter' || !e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return true
    if (e.type === 'keydown') {
      e.preventDefault()
      send('shift+enter')
    }
    return false
  })
}
