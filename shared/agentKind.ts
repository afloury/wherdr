// Type d'agent d'un pane (claude, codex…), pur, sans Nuxt.
type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const sessionAgent = (x: Json | null | undefined): string | null =>
  (x && x.agent_session && typeof x.agent_session.agent === 'string' && x.agent_session.agent) || null

// `raw` : le pane de `session.snapshot` ; `entry` : son entrée dans `agents`
// (agent nommé). Le processus détecté par Herdr fait foi tant qu'il tourne. Un
// agent fermé n'en a plus : on croit alors la session que l'intégration de
// l'agent a rapportée (`agent_session.agent`), et seulement ensuite l'entrée
// `agents`, qui garde le type de lancement (un thread lancé en Codex puis repris
// sous Claude y resterait « codex »).
export function paneAgentKind(raw: Json, entry?: Json | null): string | null {
  return raw.agent || sessionAgent(raw) || sessionAgent(entry) || (entry && entry.agent) || null
}

// Type d'après le chemin de la transcription (~/.claude/projects, ~/.codex/sessions).
export function transcriptKind(file: string): 'claude' | 'codex' | null {
  if (/\/\.claude\/projects\//.test(file)) return 'claude'
  if (/\/\.codex\/(?:archived_)?sessions\//.test(file)) return 'codex'
  return null
}
