// Ligne d'activité de Claude Code, lue à l'écran pendant qu'il travaille :
//   ✢ Boondoggling… (1m 14s · ↓ 4.6k tokens · thinking)
// Glyphe animé (· ✢ ✳ ✶ ✻ ✽, * sous Linux), verbe fantaisiste, « … », puis entre
// parenthèses durée, jetons et état de réflexion (Claude Code 2.1.x). Le verbe
// n'est pas dans la transcription : seul l'écran le donne.
//
// La ligne commence en colonne 0 (les messages de Claude sont précédés de ⏺ et
// leurs suites indentées, ceux de l'utilisateur de ❯) et se trouve au-dessus du
// cadre du champ de saisie : on cherche de bas en haut, au-dessus de ce cadre.

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
  // Cadre du champ de saisie : deux traits horizontaux ; la ligne d'activité
  // est au-dessus du premier. Sans cadre (panneau ouvert…), le bas de l’écran.
  let end = lines.length
  const rules: number[] = []
  for (let i = lines.length - 1; i >= 0 && rules.length < 2; i--) if (RULE_RE.test(lines[i]!)) rules.push(i)
  if (rules.length === 2) end = rules[1]!
  // Au plus 20 lignes au-dessus (liste de tâches, astuce « ⎿ Tip: … » entre les deux).
  for (let i = end - 1; i >= Math.max(0, end - 20); i--) {
    const a = parseClaudeActivityLine(lines[i]!)
    if (a) return a
  }
  return null
}
