// Menu contextuel des en-têtes (clic droit sur ordinateur, appui long au
// doigt) : où il ne doit pas s'ouvrir. Pur (testé).
type El = { closest?: (sel: string) => unknown } | null | undefined

// Zones qui gardent le menu natif du navigateur (champ de saisie, terminal,
// texte de la conversation) même si elles se trouvent dans un en-tête.
export const NATIVE_MENU = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], .xterm, .term, .chat-list, .msg'
// Appui long : ignoré sur les boutons, liens, onglets et la poignée de
// déplacement (ils ont leur propre geste).
export const PRESS_SKIP = `button, a, [role="tab"], [role="button"]:not(.plan-cell), .cell-grip, ${NATIVE_MENU}`

export function keepsNativeMenu(target: El): boolean {
  return !!target?.closest?.(NATIVE_MENU)
}
export function skipsPress(target: El): boolean {
  return !!target?.closest?.(PRESS_SKIP)
}
