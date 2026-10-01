// Presentation of a pane (conversation, terminal, Project panel): which
// controls the agent view shows, and what a tap on a toggle does.

type Mode = 'chat' | 'term' | 'project'

// Phone: header icons (terminal `>_`, Project); computer: small
// Conversation / Terminal selector in the header (`header`) or in
// the side-by-side cell header (`cell`). Nothing for an agent without
// conversation (shell, Kimi…): it stays on the terminal. Side by side, each
// cell keeps its selector, focused or not.
export function viewControls(o: { desk: boolean, cell: boolean, chat: boolean, live: boolean, project: boolean }) {
  const on = o.chat && (o.live || (o.desk && o.cell))
  return {
    selector: on && o.desk ? (o.cell ? 'cell' as const : 'header' as const) : null,
    term: on && !o.desk,
    project: on && !o.desk && o.project,
  }
}

// The terminal takes input directly on a computer, including in a side-by-side
// cell. The field stays useful on the phone and in the conversation;
// a side-by-side cell keeps it even without the focus (nothing moves on click).
export function showComposer(o: { desk: boolean, live: boolean, mode: Mode | 'mirror' | null, cell?: boolean }) {
  return (o.live || Boolean(o.desk && o.cell)) && (!o.desk || (o.mode !== 'term' && o.mode !== 'mirror'))
}

// Side-by-side cell: the mode chosen for this pane, whether it has the focus or not.
// Conversation (the Project panel does not exist in a cell) or terminal mirror;
// without a conversation, always the mirror.
export function cellMode(o: { chat: boolean, viewMode: Mode }): 'chat' | 'mirror' {
  return o.chat && o.viewMode !== 'term' ? 'chat' : 'mirror'
}

export function terminalAttachment(o: { desk: boolean, live: boolean, mode: Mode | 'mirror' | null, available: boolean }) {
  return o.desk && o.live && o.available && (o.mode === 'term' || o.mode === 'mirror')
}

// A single tab: the "+" button fits in the header. From the second one,
// the row of tabs precedes the header and carries the button itself.
export function spaceTabControls(count: number) {
  return { row: count > 1, headerAdd: count === 1 }
}

// A tap on a toggle shows it; a second one goes back to the conversation.
export function toggleViewMode(current: Mode | 'mirror' | null, target: Exclude<Mode, 'chat'>): Mode {
  return current === target ? 'chat' : target
}

// Side by side: Ctrl/⌘ + Alt + arrow gives focus to the neighbouring cell (Herdr's
// reading order: left / up = previous, right / down = next).
// Caught before the terminal, where Tab and the arrows go to the pane.
export function cellFocusStep(e: { key: string, altKey: boolean, ctrlKey: boolean, metaKey: boolean, shiftKey: boolean }): 1 | -1 | 0 {
  if (!e.altKey || !(e.ctrlKey || e.metaKey) || e.shiftKey) return 0
  return ({ ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 } as const)[e.key as 'ArrowLeft'] ?? 0
}
