// Commande « / » envoyée depuis la conversation : faut-il montrer son résultat
// (panneau « ❯ /cmd », lu sur l'écran du terminal) ?
//
// Seules les commandes locales de l'agent (/usage, /context, /cost…) affichent
// un résultat à l'écran sans répondre. Un skill ou une commande personnalisée
// (/daily-log…) fait travailler l'agent : message utilisateur normal, état
// « l'agent travaille » habituel, jamais le texte d'écran (« ✢ Roosting… »).
import type { SlashCommand } from './types'

// Ligne d'activité de Claude (« ✢ Roosting… (3s · ↓ 1k tokens) », « * Working… »),
// réponse (« ⏺ … ») ou « esc to interrupt » : l'agent répond, pas une sortie.
const GLYPHS = '·✢✳✶✻✽✺✹✷✸*∗'
const ACTIVITY = new RegExp(`^\\s*[${GLYPHS}]\\s+\\p{L}[\\p{L}'’\\-]*(?: \\p{L}[\\p{L}'’\\-]*){0,3}(?:…|\\.\\.\\.)(?:\\s+\\(.*\\))?\\s*$`, 'u')
const REPLY = /^\s*[⏺●]\s+\S/
const INTERRUPT = /\besc to interrupt\b/i

// Le skill / la commande personnalisée du catalogue (« daily-log » ou « /daily-log »).
export function isAgentCommand(cmd: string, catalog: readonly SlashCommand[]): boolean {
  const name = cmd.replace(/^\//, '').toLowerCase()
  return catalog.some(c => c.source !== 'builtin' && c.name.toLowerCase() === name)
}

// Sous la ligne « ❯ /cmd » (la dernière), l'agent travaille ou répond.
export function agentAnswering(screen: string, cmd: string): boolean {
  const lines = screen.replace(/\s+$/, '').split('\n')
  let start = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.includes(cmd) && /^\s*[❯›>]/.test(lines[i]!)) { start = i + 1; break }
  }
  // Ligne de commande absente (panneau de réglages plein écran) : un résultat.
  if (start < 0) return false
  return lines.slice(start).some(l => ACTIVITY.test(l) || REPLY.test(l) || INTERRUPT.test(l))
}
