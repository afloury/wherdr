// Quotas de l'accueil, répartis entre le haut de la liste et les machines. Pur, sans Vue.
//  - Un compte commun à toutes les machines en ligne (Codex, ou un seul compte
//    Claude) : une fois en haut, comme avant.
//  - Comptes différents (Claude ou Codex) : chaque machine a le tableau de son
//    compte sous son en-tête (replié avec elle), plus rien de cet agent en haut.
import type { ClaudeSetup, Quota, QuotaWindow, Quotas } from '../../shared/types'
import installer from '../../scripts/install-claude-statusline.sh?raw'

export interface QuotaRow { key: string, agent: 'claude' | 'codex', q: Quota }

// Lignes du haut de l'accueil.
export function quotaRows(q: Quotas | null, hidden: readonly string[] = []): QuotaRow[] {
  if (!q) return []
  const rows: QuotaRow[] = []
  if (q.claude && !hidden.includes('claude') && !((q.claudeAccounts?.length || 0) > 1)) rows.push({ key: 'claude', agent: 'claude', q: q.claude })
  if (q.codex && !hidden.includes('codex') && !((q.codexAccounts?.length || 0) > 1)) rows.push({ key: 'codex', agent: 'codex', q: q.codex })
  return rows
}

// Lignes propres à une machine (clé '' = locale) : son compte Claude, son compte
// Codex, chacun seulement quand les machines n'utilisent pas le même.
export function machineQuotaRows(q: Quotas | null, key: string, hidden: readonly string[] = []): QuotaRow[] {
  if (!q) return []
  const rows: QuotaRow[] = []
  for (const agent of ['claude', 'codex'] as const) {
    const list = agent === 'claude' ? q.claudeAccounts : q.codexAccounts
    if (hidden.includes(agent) || (list?.length || 0) < 2) continue
    const a = list!.find(a => a.machines.some(m => m.key === key))
    if (!a) continue
    const { machines: _, ...quota } = a
    rows.push({ key: `${agent}:${key}`, agent, q: quota })
  }
  return rows
}

// Bandeau « quotas Claude non configurés » d'une machine qui a des agents Claude.
export function claudeSetupOf(q: Quotas | null, key: string, hasClaude: boolean, hidden: readonly string[] = []): ClaudeSetup | null {
  if (!hasClaude || hidden.includes('claude')) return null
  return q?.claudeSetup?.find(s => s.key === key) || null
}

// Commande autonome à coller dans un terminal de la machine : le script
// d'installation (barre d'état comprise) passé à sh, identique partout.
export const claudeInstallCommand = `sh <<'WHERDR_INSTALL'\n${installer.trimEnd()}\nWHERDR_INSTALL\n`

// Part restante (%) ; fenêtre déjà réinitialisée depuis la lecture : tout est revenu.
export function quotaLeft(w: QuotaWindow, now: number) {
  if (w.resetsAt && w.resetsAt <= now) return 100
  return Math.round(100 - w.used)
}
// Réglages → Apparence → Quotas : part restante (défaut, comme Codex) ou part
// utilisée (comme Claude, 100 % pour une fenêtre épuisée).
export type QuotaDisplay = 'left' | 'used'
export function readQuotaDisplay(raw: string | null): QuotaDisplay {
  return raw === 'used' ? 'used' : 'left'
}
// Pourcentage affiché (chiffre et barre) ; l'alerte (`quotaLevel`) suit
// toujours ce qui reste.
export function quotaShown(w: QuotaWindow, now: number, display: QuotaDisplay) {
  const l = quotaLeft(w, now)
  return display === 'used' ? 100 - l : l
}
export const quotaLevel = (w: QuotaWindow, now: number) => {
  const l = quotaLeft(w, now)
  return l <= 15 ? 'hi' : l <= 40 ? 'mid' : 'lo'
}

// Lecture de plus d'une heure : chiffres à prendre avec prudence.
export const STALE_MS = 3600000

// Heure de réinitialisation : l'heure seule dans les prochaines 24 h (même le
// lendemain : « 00:00 » et non « dim. 00:00 », qui ressemble à la semaine),
// le jour en plus au-delà. `null` : déjà réinitialisée ; '' : inconnue.
export function resetText(w: QuotaWindow, now: number, locale: string): string | null {
  if (!w.resetsAt) return ''
  if (w.resetsAt <= now) return null
  const d = new Date(w.resetsAt)
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  return w.resetsAt - now < 86400000 ? time : `${d.toLocaleDateString(locale, { weekday: 'short' })} ${time}`
}
