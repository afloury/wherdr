// Lecture de l'écran de Claude Code pour le bouton Stop : tâches de fond
// (shells lancés en arrière-plan, sous-agents) qu'un Échap n'arrête pas, et
// panneau de gestion ouvert par ↓ (« Background » / liste des agents).

export interface BackgroundScreen {
  // Shells de fond signalés dans le pied (« · 2 shells »).
  shells: number
  // Sous-agents de fond (« Waiting for 1 background agent », lignes ◯ du panneau).
  agents: number
  // Panneau ouvert : liste des shells, détail d'un shell, liste des agents.
  panel: 'shells' | 'shell' | 'agents' | null
  // La ligne sélectionnée du panneau peut être arrêtée (« x to stop »).
  canStop: boolean
  // Panneau des agents : rang de la ligne sélectionnée et nombre de lignes.
  selected: number
  rows: number
}

export function parseBackground(text: string | null | undefined): BackgroundScreen {
  const lines = String(text || '').split('\n').map(l => l.replace(/\s+$/, ''))
  const all = lines.join('\n')
  const tail = lines.filter(l => l.trim()).slice(-8).join('\n')
  const shellsM = /·\s*(\d+)\s+shells?\b/.exec(tail) || /·\s*(\d+)\s+shells?\s+still running/.exec(all)
  // Bas de l'écran seulement : plus haut, ce sont des lignes d'un tour passé.
  const waitM = /Waiting for (\d+) background agents?/.exec(tail)
  const agentRows = tail.split('\n').filter(l => /^\s*(❯\s*)?[◯●]\s+\S/.test(l) && !/^\s*(❯\s*)?●\s+main\s*$/.test(l) && /\s{3,}\S/.test(l.trim()))
  const listIdx = lines.findIndex(l => /^\s*(❯\s*)?●\s+main\s*$/.test(l))
  let panel: BackgroundScreen['panel'] = null
  let selected = -1
  let rows = 0
  if (/^\s*Shell details\s*$/m.test(all)) panel = 'shell'
  else if (/^\s*Background\s*$/m.test(all) && /Esc to close/.test(tail)) panel = 'shells'
  else if (listIdx >= 0 && /(↑\/↓ to select|Enter to view|x to (stop|clear))/.test(tail)) {
    panel = 'agents'
    const rowLines = lines.slice(listIdx).filter(l => /^\s*(❯\s*)?[◯●]\s+\S/.test(l))
    rows = rowLines.length
    selected = rowLines.findIndex(l => /^\s*❯/.test(l))
  }
  return {
    shells: shellsM ? Number(shellsM[1]) : 0,
    agents: Math.max(waitM ? Number(waitM[1]) : 0, agentRows.filter(l => /◯/.test(l)).length),
    panel,
    // Détail d'un shell : la légende peut sortir de l'écran, « x » l'arrête.
    canStop: /x to stop/.test(tail) || (panel === 'shell' && /Status:\s+running/.test(all)),
    selected,
    rows,
  }
}

// Prochaine touche pour arrêter les tâches de fond, ou null quand c'est fini.
// `opened` : nombre de fois où l'on a déjà tenté d'ouvrir le panneau.
export function nextBackgroundKey(s: BackgroundScreen, opened: number): 'x' | 'down' | 'enter' | 'esc' | null {
  if (s.canStop) return 'x'
  if (s.panel === 'agents') {
    // Descendre jusqu'à une ligne encore en cours ; en bas de liste, refermer.
    if (s.selected < s.rows - 1) return 'down'
    return 'esc'
  }
  if (s.panel) return 'esc'
  if ((s.shells || s.agents) && opened < 2) return 'down'
  return null
}
