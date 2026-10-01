// Reason a terminal was closed, sent by the server: the known cases
// (machine unreachable or unknown) come with a code, translated here; Herdr's
// messages stay as they are ("already open elsewhere" banners…).
import { t, tl } from './i18n'

export function terminalClosedText(m: { reason?: string, code?: string, machine?: string }): string {
  if (m.code === 'unreachable') return tl(`${m.machine || 'Machine'} unreachable`, `${m.machine || 'Machine'} injoignable`)
  if (m.code === 'unknown_machine') return tl('unknown machine', 'machine inconnue')
  return t(m.reason || '')
}

export function terminalUnavailableText(why: string | null): string {
  return why ? tl(`Terminal unavailable: ${why}`, `Terminal indisponible : ${why}`) : t('Terminal unavailable')
}
