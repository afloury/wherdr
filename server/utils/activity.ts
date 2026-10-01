// Claude Code's activity line, read from the screen while it works:
//   ✢ Boondoggling… (1m 14s · ↓ 4.6k tokens · thinking)
// Animated glyph (· ✢ ✳ ✶ ✻ ✽, * on Linux), whimsical verb, "…", then in
// parentheses duration, tokens and thinking state (Claude Code 2.1.x). The verb
// is not in the transcript: only the screen gives it.
//
// The line starts at column 0 (Claude's messages are preceded by ⏺ and
// their continuations indented, the user's by ❯) and sits above the
// input field frame: we search bottom-up, above that frame.

export interface ClaudeActivity {
  glyph: string
  verb: string
  elapsed: string | null
  tokens: string | null
}

const GLYPHS = '·✢✳✶✻✽✺✹✷✸*∗'
const LINE_RE = new RegExp(`^([${GLYPHS}])\\s+(\\p{L}[\\p{L}'’\\-]*(?: \\p{L}[\\p{L}'’\\-]*){0,3})(?:…|\\.\\.\\.)(?:\\s+\\((.*)\\))?\\s*$`, 'u')
const RULE_RE = /^\s*[─━]{8,}\s*$/

export function parseClaudeActivityLine(line: string): ClaudeActivity | null {
  const m = LINE_RE.exec(line.replace(/\s+$/, ''))
  if (!m) return null
  const extra = m[3] || ''
  const elapsed = /(?:^|·\s*)((?:\d+h\s*)?(?:\d+m\s*)?\d+s)\b/.exec(extra)
  const tokens = /[↑↓]\s*([\d.,]+\s*[kKM]?)\s*tokens?/.exec(extra)
  return {
    glyph: m[1]!,
    verb: m[2]!,
    elapsed: elapsed ? elapsed[1]!.replace(/\s+/g, ' ').trim() : null,
    tokens: tokens ? tokens[1]!.replace(/\s+/g, '') : null,
  }
}

export function parseClaudeActivity(screen: string | null | undefined): ClaudeActivity | null {
  if (!screen) return null
  const lines = screen.split('\n')
  // Input field frame: two horizontal rules; the activity line
  // is above the first one. Without a frame (panel open…), the bottom of the screen.
  let end = lines.length
  const rules: number[] = []
  for (let i = lines.length - 1; i >= 0 && rules.length < 2; i--) if (RULE_RE.test(lines[i]!)) rules.push(i)
  if (rules.length === 2) end = rules[1]!
  // At most 20 lines above (task list, "⎿ Tip: …" hint in between).
  for (let i = end - 1; i >= Math.max(0, end - 20); i--) {
    const a = parseClaudeActivityLine(lines[i]!)
    if (a) return a
  }
  return null
}
