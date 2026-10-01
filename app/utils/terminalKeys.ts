// Maj+Entrée dans un terminal xterm.js : xterm envoie « \r », comme Entrée,
// et l'agent valide au lieu d'aller à la ligne. On passe la touche nommée à
// Herdr, qui l'encode selon le mode du programme (protocole clavier kitty,
// sinon modifyOtherKeys), comme depuis un vrai terminal.
import type { Terminal } from '@xterm/xterm'

// `send` reçoit la touche nommée ; xterm n'émet rien pour cette frappe.
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
