// Keys of an xterm.js terminal that must not take xterm's default path.
// - Shift+Enter: xterm sends "\r", like Enter, and the agent confirms instead of
//   starting a new line. We pass the named key to Herdr, which encodes it
//   according to the program's mode (kitty keyboard protocol, otherwise
//   modifyOtherKeys), as from a real terminal.
// - Ctrl+V outside Apple devices (Windows, Linux, ChromeOS, Android): xterm
//   would send ^V to the program, and the browser would never fire its paste.
//   The program's own Ctrl+V reads the clipboard of the machine it runs on, not
//   the browser's. Left to the browser, the native paste event reaches xterm
//   (text) and bindTerminalImagePaste (images). On a Mac and an iPhone the paste
//   is ⌘V and Ctrl+V stays a key for the program.
// - F12: the browser's developer tools.
import type { Terminal } from '@xterm/xterm'

type NavigatorPlatform = { platform?: string, userAgentData?: { platform?: string } }

// Mac, iPhone, iPad. userAgentData (Chromium) says "macOS" or "iOS";
// navigator.platform says "MacIntel", "iPhone", "iPad".
export function isApplePlatform(nav: NavigatorPlatform | undefined = globalThis.navigator): boolean {
  const p = nav?.userAgentData?.platform || nav?.platform || ''
  return /^(mac|iphone|ipad|ipod|ios)/i.test(p)
}

type KeyLike = Pick<KeyboardEvent, 'key' | 'code' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey' | 'isComposing'>

// The V key, also on a layout that does not type Latin letters (Cyrillic: the
// browser still pastes with Ctrl + the key at V).
function isV(e: KeyLike) {
  const k = e.key.toLowerCase()
  return k === 'v' || (e.code === 'KeyV' && !/^[a-z]$/.test(k))
}

// 'browser': xterm ignores the key, the browser does its default action.
// 'shift+enter': sent as a named key. 'xterm': xterm handles it as usual.
export function terminalKeyAction(e: KeyLike, apple: boolean): 'browser' | 'shift+enter' | 'xterm' {
  if (e.isComposing) return 'xterm'
  const mods = e.ctrlKey || e.altKey || e.metaKey
  if (e.key === 'Enter' && e.shiftKey && !mods) return 'shift+enter'
  if (e.key === 'F12' && !e.shiftKey && !mods) return 'browser'
  if (!apple && e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && isV(e)) return 'browser'
  return 'xterm'
}

// `send` receives the named key; xterm emits nothing for this keystroke.
export function bindTerminalKeys(term: Terminal, send: (key: 'shift+enter') => void, apple = isApplePlatform()) {
  term.attachCustomKeyEventHandler((e) => {
    const action = terminalKeyAction(e, apple)
    if (action === 'xterm') return true
    if (action === 'shift+enter' && e.type === 'keydown') {
      e.preventDefault()
      send('shift+enter')
    }
    // false without preventDefault: the browser keeps its default action
    // (paste event, developer tools).
    return false
  })
}
