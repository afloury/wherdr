// Finish (`herdr-projects finish`): the work is taken as it is, checked, then
// reviewed. What the button says next to Retry, and what it asks first.
import { type FinishCase, finishCase } from '../../shared/projectsTasks'
import { tl } from './i18n'

// One line: what Retry does, what Finish does, for this case.
export function finishHint(c: FinishCase): string {
  switch (c) {
    case 'conversation': return tl('End this conversation when you are done.', 'Termine cette conversation quand tu as fini.')
    case 'limit': return tl(
      'Continue grants a new allowance. Raising the limit keeps usage and resumes automatically. Take as is: checks, then review. These work limits are separate from provider quotas.',
      'Continuer accorde une nouvelle tranche. Relever la limite conserve la consommation et reprend automatiquement. Prendre tel quel : vérifications puis relecture. Ces limites de travail sont distinctes des quotas fournisseur.')
    case 'nosummary': return tl(
      'Retry: the agent goes on. Finish: the work is taken as it is, its screen as the summary, checked, then reviewed.',
      'Réessayer : l’agent continue. Terminer : le travail est pris tel quel, son écran comme résumé, vérifié, puis relu.')
    case 'stuck': return tl(
      'Its agent is at rest, but the board did not see its turn end. Finish: the work is taken as it is, with what the agent said last, checked, then reviewed.',
      'Son agent est au repos, mais le board n’a pas vu la fin de son tour. Terminer : le travail est pris tel quel, avec ce que l’agent a dit en dernier, vérifié, puis relu.')
  }
}

export const finishLabel = (chat = false) => chat ? tl('End conversation', 'Terminer la conversation') : tl('Finish', 'Terminer')
export const finishTitle = (chat = false) => chat ? tl('End this conversation', 'Terminer cette conversation') : tl('Take the work as it is: checks, then review', 'Prendre le travail tel quel : vérifications puis relecture')
export const finishQuestion = (title: string, chat = false) => chat ? tl(`End “${title}”?`, `Terminer la conversation « ${title} » ?`) : tl(
  `Take “${title}” as it is? Its checks run, then its review. If this task merges by itself (merge.by itself), it can merge without asking you.`,
  `Prendre « ${title} » tel quel ? Ses vérifications tournent, puis sa relecture. Si cette tâche fusionne d’elle-même (merge.by itself), elle peut fusionner sans te demander.`)

// Finish as the row allows it. On a row stuck at "Finishing", not while Herdr
// shows its agent at work or waiting (1.x refuses then: "still at work").
export function finishOffered(r: Parameters<typeof finishCase>[0], paneStatus: string | null): boolean {
  const c = finishCase(r)
  return c !== null && !(c === 'stuck' && (paneStatus === 'working' || paneStatus === 'blocked'))
}
