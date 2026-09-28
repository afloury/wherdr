// Raison de fermeture d'un terminal envoyée par le serveur : les cas connus
// (machine injoignable ou inconnue) arrivent avec un code, traduit ici ; les
// messages de Herdr restent tels quels (bannières « déjà ouvert ailleurs »…).
import { t, tl } from './i18n'

export function terminalClosedText(m: { reason?: string, code?: string, machine?: string }): string {
  if (m.code === 'unreachable') return tl(`${m.machine || 'Machine'} injoignable`, `${m.machine || 'Machine'} unreachable`)
  if (m.code === 'unknown_machine') return tl('machine inconnue', 'unknown machine')
  return m.reason || ''
}

export function terminalUnavailableText(why: string | null): string {
  return why ? tl(`Terminal indisponible : ${why}`, `Terminal unavailable: ${why}`) : t('Terminal indisponible')
}
