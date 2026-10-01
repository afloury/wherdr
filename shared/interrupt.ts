// Reading Claude Code's screen for the Stop button: background tasks
// (shells started in the background, subagents) that Escape does not stop, and
// the management panel opened by ↓ ("Background" / agent list).

export interface BackgroundScreen {
  // Background shells reported in the footer ("· 2 shells").
  shells: number
  // Background subagents ("Waiting for 1 background agent", ◯ lines of the panel).
  agents: number
  // Panel open: shell list, shell detail, agent list.
  panel: 'shells' | 'shell' | 'agents' | null
  // The selected line of the panel can be stopped ("x to stop").
  canStop: boolean
  // Agent panel: index of the selected line and number of lines.
  selected: number
  rows: number
}

export function parseBackground(text: string | null | undefined): BackgroundScreen {
  const lines = String(text || '').split('\n').map(l => l.replace(/\s+$/, ''))
  const all = lines.join('\n')
  const tail = lines.filter(l => l.trim()).slice(-8).join('\n')
  const shellsM = /·\s*(\d+)\s+shells?\b/.exec(tail) || /·\s*(\d+)\s+shells?\s+still running/.exec(all)
  // Bottom of the screen only: further up are lines from a past turn.
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
    // Shell detail: the legend may scroll off screen, "x" stops it.
    canStop: /x to stop/.test(tail) || (panel === 'shell' && /Status:\s+running/.test(all)),
    selected,
    rows,
  }
}

// Next key to stop the background tasks, or null when done.
// `opened`: number of times we already tried to open the panel.
export function nextBackgroundKey(s: BackgroundScreen, opened: number): 'x' | 'down' | 'enter' | 'esc' | null {
  if (s.canStop) return 'x'
  if (s.panel === 'agents') {
    // Move down to a line still running; at the bottom of the list, close.
    if (s.selected < s.rows - 1) return 'down'
    return 'esc'
  }
  if (s.panel) return 'esc'
  if ((s.shells || s.agents) && opened < 2) return 'down'
  return null
}
