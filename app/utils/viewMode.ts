// Présentation d'un pane (conversation, terminal, panneau Projet) : quelles
// commandes la vue agent montre, et ce que fait un toucher sur une bascule.

type Mode = 'chat' | 'term' | 'project'

// Téléphone : icônes d'en-tête (terminal `>_`, Projet) ; ordinateur : petit
// sélecteur Conversation / Terminal dans l'en-tête (`header`) ou dans
// l'en-tête de la case côte à côte (`cell`). Rien pour un agent sans
// conversation (shell, Kimi…) : il reste sur le terminal. Côte à côte, chaque
// case garde son sélecteur, focalisée ou non.
export function viewControls(o: { desk: boolean, cell: boolean, chat: boolean, live: boolean, project: boolean }) {
  const on = o.chat && (o.live || (o.desk && o.cell))
  return {
    selector: on && o.desk ? (o.cell ? 'cell' as const : 'header' as const) : null,
    term: on && !o.desk,
    project: on && !o.desk && o.project,
  }
}

// Le terminal se saisit directement sur ordinateur, y compris dans une case
// côte à côte. Le champ reste utile sur téléphone et dans la conversation ;
// une case côte à côte le garde même sans le focus (rien ne bouge au clic).
export function showComposer(o: { desk: boolean, live: boolean, mode: Mode | 'mirror' | null, cell?: boolean }) {
  return (o.live || Boolean(o.desk && o.cell)) && (!o.desk || (o.mode !== 'term' && o.mode !== 'mirror'))
}

// Case côte à côte : le mode choisi pour ce pane, qu'elle ait le focus ou non.
// Conversation (le panneau Projet n'existe pas en case) ou miroir du terminal ;
// sans conversation, toujours le miroir.
export function cellMode(o: { chat: boolean, viewMode: Mode }): 'chat' | 'mirror' {
  return o.chat && o.viewMode !== 'term' ? 'chat' : 'mirror'
}

export function terminalAttachment(o: { desk: boolean, live: boolean, mode: Mode | 'mirror' | null, available: boolean }) {
  return o.desk && o.live && o.available && (o.mode === 'term' || o.mode === 'mirror')
}

// Un seul onglet : le bouton « + » tient dans l'en-tête. Dès le deuxième,
// la rangée d'onglets précède l'en-tête et porte elle-même le bouton.
export function spaceTabControls(count: number) {
  return { row: count > 1, headerAdd: count === 1 }
}

// Un toucher sur une bascule l'affiche ; un second revient à la conversation.
export function toggleViewMode(current: Mode | 'mirror' | null, target: Exclude<Mode, 'chat'>): Mode {
  return current === target ? 'chat' : target
}

// Côte à côte : Ctrl/⌘ + Alt + flèche donne le focus à la case voisine (ordre
// de lecture de Herdr : gauche / haut = précédente, droite / bas = suivante).
// Capté avant le terminal, où Tab et les flèches partent au pane.
export function cellFocusStep(e: { key: string, altKey: boolean, ctrlKey: boolean, metaKey: boolean, shiftKey: boolean }): 1 | -1 | 0 {
  if (!e.altKey || !(e.ctrlKey || e.metaKey) || e.shiftKey) return 0
  return ({ ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 } as const)[e.key as 'ArrowLeft'] ?? 0
}
