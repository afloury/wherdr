// Présentation d'un pane (conversation, terminal, panneau Projet) : quelles
// commandes la vue agent montre, et ce que fait un toucher sur une bascule.

type Mode = 'chat' | 'term' | 'project'

// Téléphone : icônes d'en-tête (terminal `>_`, Projet) ; ordinateur : petit
// sélecteur Conversation / Terminal dans l'en-tête (`header`) ou dans
// l'en-tête de la case côte à côte (`cell`). Rien pour un agent sans
// conversation (shell, Kimi…) : il reste sur le terminal.
export function viewControls(o: { desk: boolean, cell: boolean, chat: boolean, live: boolean, project: boolean }) {
  const on = o.chat && o.live
  return {
    selector: on && o.desk ? (o.cell ? 'cell' as const : 'header' as const) : null,
    term: on && !o.desk,
    project: on && !o.desk && o.project,
  }
}

// Le terminal se saisit directement sur ordinateur, y compris dans une case
// côte à côte. Le champ reste utile sur téléphone et dans la conversation.
export function showComposer(o: { desk: boolean, live: boolean, mode: Mode | 'mirror' | null }) {
  return o.live && (!o.desk || (o.mode !== 'term' && o.mode !== 'mirror'))
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
