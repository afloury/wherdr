// Clavier (ordinateur) sur une carte « À toi » à choix (menu interactif,
// permission, question numérotée) : ↑/↓/Entrée/Échap partent au terminal comme
// de vraies touches, les chiffres 1-9 choisissent une option numérotée.
// Règle de capture : la carte est affichée dans la vue active, aucune fenêtre
// (modale, menu déroulant) n'est ouverte, et le focus n'est pas dans un champ
// de saisie qui contient du texte. Le champ du message, focalisé d'office sur
// ordinateur, est vide la plupart du temps : il laisse passer ↑/↓/Entrée/Échap
// et les chiffres (comme dans le terminal, où un chiffre choisit l'option) ;
// dès qu'on y a tapé une lettre, plus rien n'est pris.
// Focus sur un bouton : Entrée / Espace gardent leur effet natif (le clic).
export type CardKey = { kind: 'nav', key: 'up' | 'down' | 'enter' | 'esc' } | { kind: 'digit', n: number }

export interface FocusInfo {
  // Champ de saisie (input texte, textarea, contenteditable).
  editable: boolean
  // … et vide.
  empty: boolean
  // Bouton, lien, case : Entrée l'active.
  control: boolean
  // Dans une fenêtre ouverte par-dessus (dialogue, menu, liste déroulante).
  overlay: boolean
  // Champ de recherche de la carte elle-même : ↑/↓ y restent pris (une seule
  // ligne, rien à y déplacer), Entrée y lance la recherche.
  own?: boolean
}

export interface KeyInfo { key: string, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean, shiftKey?: boolean, isComposing?: boolean, defaultPrevented?: boolean }

const NAV: Record<string, 'up' | 'down' | 'enter' | 'esc'> = { ArrowUp: 'up', ArrowDown: 'down', Enter: 'enter', Escape: 'esc' }

export function cardKey(e: KeyInfo, f: FocusInfo, opts: { digits: number, enter: boolean }): CardKey | null {
  if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || f.overlay) return null
  const nav = NAV[e.key]
  if (f.own && (nav === 'up' || nav === 'down') && !e.shiftKey) return { kind: 'nav', key: nav }
  if (f.own && nav === 'enter') return null
  if (f.editable && !f.empty) return null
  if (nav) {
    if (e.shiftKey) return null
    if (nav === 'enter' && (f.control || !opts.enter)) return null
    return { kind: 'nav', key: nav }
  }
  if (/^[1-9]$/.test(e.key) && !f.own) {
    const n = Number(e.key)
    return n <= opts.digits ? { kind: 'digit', n } : null
  }
  return null
}

const TEXT_INPUT = /^(?:text|search|email|url|tel|password|number|)$/
export function describeFocus(el: Element | null): FocusInfo {
  const out: FocusInfo = { editable: false, empty: true, control: false, overlay: false }
  if (!el || el === document.body) return out
  out.overlay = Boolean(el.closest('[role="dialog"], [role="menu"], [role="listbox"], [role="alertdialog"]'))
  if (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && TEXT_INPUT.test(el.type))) {
    out.editable = true
    out.empty = !el.value
  } else if ((el as HTMLElement).isContentEditable) {
    out.editable = true
    out.empty = !(el.textContent || '').trim()
  } else if (el.closest('button, a[href], select, input, [role="button"], [role="tab"], [role="switch"], summary')) {
    out.control = true
  }
  return out
}

// Écoute le clavier tant que `active()` : une seule carte à la fois (la vue
// active ; en côte à côte, la case active).
export function useCardKeys(active: () => boolean, opts: () => { digits: number, enter: boolean, own?: Element | null }, run: (k: CardKey) => void) {
  function onKey(e: KeyboardEvent) {
    if (!active()) return
    const o = opts()
    const el = document.activeElement
    const k = cardKey(e, { ...describeFocus(el), own: Boolean(o.own && el === o.own) }, o)
    if (!k) return
    e.preventDefault()
    e.stopPropagation()
    run(k)
  }
  onMounted(() => document.addEventListener('keydown', onKey))
  onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
}
