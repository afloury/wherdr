// A `wherdr` fenced block in an agent's message: one element per line
// (`kind arg…`), shown in place by the chat (utils/markdown.ts). It only shows
// or opens something, never acts. A block with any line that does not parse
// is null, and stays plain code.
//
//   task WHR-12   the task's live card, read from the board (ChatTaskCard.vue)
export type WherdrElement = { kind: 'task', id: string }

const TASK = /^task\s+([A-Za-z][\w.-]*-\d+)$/

export function parseWherdrBlock(text: string): WherdrElement[] | null {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  if (!lines.length) return null
  const out: WherdrElement[] = []
  for (const line of lines) {
    const task = TASK.exec(line)
    if (!task) return null
    out.push({ kind: 'task', id: task[1]! })
  }
  return out
}
