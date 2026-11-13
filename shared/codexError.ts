// Codex prints a failed turn as a "■" line in the history ("■ You've hit your usage limit.
// Upgrade to Pro (…), visit … or try again at Nov 5th, 2026 3:00 PM."), wrapped over
// several lines. It is shown in the conversation and on the card, where otherwise the
// agent only looks stuck. Only an error under the last user message and above the
// input field counts: an old one in the scrollback is not current.
export function codexError(screen: string): string | null {
  const lines = screen.replace(/\r/g, '').split('\n')
  const input = lines.findLastIndex(l => /^\s*›(?:\s|$)/.test(l))
  const end = input < 0 ? lines.length : input
  const at = lines.slice(0, end).findLastIndex(l => /^\s*■\s+\S/.test(l))
  if (at < 0) return null
  const out = [lines[at]!.replace(/^\s*■\s+/, '').trim()]
  let i = at + 1
  for (; i < end; i++) {
    const l = lines[i]!
    if (!l.trim() || /^\s*[›•■]/.test(l)) break
    out.push(l.trim())
  }
  // A reply or a message after it: the error is history.
  if (lines.slice(i, end).some(l => /^\s*[›•]/.test(l))) return null
  const text = out.join(' ').replace(/\s+/g, ' ').trim()
  return text || null
}
