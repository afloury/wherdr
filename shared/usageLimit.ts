// Claude Code 2.1.296: the live limit banner is below the input box.
// Never infer an active wait from an error left in conversation scrollback.
export interface UsageLimit {
  resets: string | null
  automatic: boolean
  credits: boolean
  resetLink: boolean
}

export function parseUsageLimit(text: string, agent?: string | null): UsageLimit | null {
  if (agent !== 'claude') return null
  // eslint-disable-next-line no-control-regex
  const lines = text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\r/g, '').split('\n')
  const field = lines.findLastIndex((l, i) => /^\s*❯(?:\s|$)/.test(l) && /^\s*─{3,}/.test(lines[i - 1] || ''))
  if (field < 0) return null
  const rule = lines.findIndex((l, i) => i > field && /^\s*─{3,}/.test(l))
  if (rule < 0) return null
  const tail = lines.slice(rule + 1)
  // A quoted old quota screen above a newer approval/menu is scrollback.
  if (tail.length > 10 || tail.some(l => /[╭┌]─|\benter to (?:select|confirm)\b|^\s*[❯›]\s*\d+\./i.test(l))) return null
  const footer = tail.join('\n')
  const limit = footer.match(/^\s*(?:⚠\s*)?Usage limit reached(?:\s*·\s*limit resets ([^\n]+))?\s*$/m)
  if (!limit) return null
  const resume = footer.match(/^\s*Continuing automatically (.+?)\s*·\s*esc to cancel\b/im)
  return {
    resets: limit[1]?.trim() || resume?.[1]?.trim() || null,
    automatic: Boolean(resume),
    credits: /\/usage-credits to continue now\b/.test(footer),
    resetLink: /Use your limit reset to reset it now: clau\.de\/reset\b/.test(lines.slice(Math.max(0, field - 16), field).join('\n')),
  }
}
