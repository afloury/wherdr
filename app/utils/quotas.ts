// Home quotas, split between the top of the list and the machines. Pure, without Vue.
//  - An account shared by all online machines (Codex, or a single Claude
//    account): once at the top, as before.
//  - Different accounts (Claude or Codex): each machine has the table of its
//    account under its header (collapsed with it), nothing left of that agent at the top.
import type { ClaudeSetup, Quota, QuotaWindow, Quotas } from '../../shared/types'
import installer from '../../scripts/install-claude-statusline.sh?raw'

export interface QuotaRow { key: string, agent: 'claude' | 'codex', q: Quota }

// Rows at the top of the home screen.
export function quotaRows(q: Quotas | null, hidden: readonly string[] = []): QuotaRow[] {
  if (!q) return []
  const rows: QuotaRow[] = []
  if (q.claude && !hidden.includes('claude') && !((q.claudeAccounts?.length || 0) > 1)) rows.push({ key: 'claude', agent: 'claude', q: q.claude })
  if (q.codex && !hidden.includes('codex') && !((q.codexAccounts?.length || 0) > 1)) rows.push({ key: 'codex', agent: 'codex', q: q.codex })
  return rows
}

// Rows specific to a machine (key '' = local): its Claude account, its Codex
// account, each only when the machines do not use the same one.
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

// "Claude quotas not configured" banner of a machine that has Claude agents.
export function claudeSetupOf(q: Quotas | null, key: string, hasClaude: boolean, hidden: readonly string[] = []): ClaudeSetup | null {
  if (!hasClaude || hidden.includes('claude')) return null
  return q?.claudeSetup?.find(s => s.key === key) || null
}

// Self-contained command to paste into a terminal on the machine: the install
// script (status line included) passed to sh, identical everywhere.
export const claudeInstallCommand = `sh <<'WHERDR_INSTALL'\n${installer.trimEnd()}\nWHERDR_INSTALL\n`

// Remaining share (%); window already reset since the reading: everything is back.
export function quotaLeft(w: QuotaWindow, now: number) {
  if (w.resetsAt && w.resetsAt <= now) return 100
  return Math.round(100 - w.used)
}
// Settings → Appearance → Quotas: remaining share (default, like Codex) or used
// share (like Claude, 100 % for an exhausted window).
export type QuotaDisplay = 'left' | 'used'
export function readQuotaDisplay(raw: string | null): QuotaDisplay {
  return raw === 'used' ? 'used' : 'left'
}
// Percentage shown (number and bar); the alert (`quotaLevel`) always follows
// what remains.
export function quotaShown(w: QuotaWindow, now: number, display: QuotaDisplay) {
  const l = quotaLeft(w, now)
  return display === 'used' ? 100 - l : l
}
export const quotaLevel = (w: QuotaWindow, now: number) => {
  const l = quotaLeft(w, now)
  return l <= 15 ? 'hi' : l <= 40 ? 'mid' : 'lo'
}

// Reading older than an hour: numbers to take with caution.
export const STALE_MS = 3600000

// Reset time: the time alone within the next 24 h (even the
// next day: "00:00" and not "Sun 00:00", which looks like the weekly one),
// with the day beyond that. `null`: already reset; '': unknown.
export function resetText(w: QuotaWindow, now: number, locale: string): string | null {
  if (!w.resetsAt) return ''
  if (w.resetsAt <= now) return null
  const d = new Date(w.resetsAt)
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  return w.resetsAt - now < 86400000 ? time : `${d.toLocaleDateString(locale, { weekday: 'short' })} ${time}`
}
