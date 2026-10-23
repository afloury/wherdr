// Finish (`herdr-projects finish`): the work is taken as it is, checked, then
// reviewed. What the button says next to Retry, and what it asks first.
import { type FinishCase, finishCase } from '../../shared/projectsTasks'
import { type LimitStop, formatLimit } from '../../shared/taskLimits'
import { language, tl } from './i18n'

// One line: what Retry does, what Finish does, for this case.
export function finishHint(c: FinishCase): string {
  switch (c) {
    case 'limit': return tl(
      'Continue: the agent goes on with the same limit once more; its tokens keep adding up. Take it as it is: the work is checked, then reviewed.',
      'Continuer : l’agent reprend avec la même limite une fois de plus ; ses tokens continuent de s’additionner. Prendre telle quelle : le travail est vérifié, puis relu.')
    case 'nosummary': return tl(
      'Retry: the agent goes on. Finish: the work is taken as it is, its screen as the summary, checked, then reviewed.',
      'Réessayer : l’agent continue. Terminer : le travail est pris tel quel, son écran comme résumé, vérifié, puis relu.')
    case 'stuck': return tl(
      'Its agent is at rest, but the board did not see its turn end. Finish: the work is taken as it is, with what the agent said last, checked, then reviewed.',
      'Son agent est au repos, mais le board n’a pas vu la fin de son tour. Terminer : le travail est pris tel quel, avec ce que l’agent a dit en dernier, vérifié, puis relu.')
  }
}

export const finishLabel = () => tl('Finish', 'Terminer')
export const finishTitle = () => tl('Take the work as it is: checks, then review', 'Prendre le travail tel quel : vérifications puis relecture')
export const finishQuestion = (title: string) => tl(
  `Take “${title}” as it is? Its checks run, then its review. If this task merges by itself (merge.by itself), it can merge without asking you.`,
  `Prendre « ${title} » tel quel ? Ses vérifications tournent, puis sa relecture. Si cette tâche fusionne d’elle-même (merge.by itself), elle peut fusionner sans te demander.`)

// Finish as the row allows it. On a row stuck at "Finishing", not while Herdr
// shows its agent at work or waiting (1.x refuses then: "still at work").
export function finishOffered(r: Parameters<typeof finishCase>[0], paneStatus: string | null): boolean {
  const c = finishCase(r)
  return c !== null && !(c === 'stuck' && (paneStatus === 'working' || paneStatus === 'blocked'))
}

// A task stopped at a limit (herdr-projects 1.2.16+): Continue (`retry`),
// Raise the limit (`set limit.*`), Take it as it is (`finish`).
export const continueLabel = () => tl('Continue', 'Continuer')
export const raiseLabel = () => tl('Raise the limit', 'Relever la limite')
export const takeAsIsLabel = () => tl('Take it as it is', 'Prendre telle quelle')
export function limitHint(stop: LimitStop): string {
  const v = formatLimit(stop.kind, stop.limit, language)
  const same = stop.kind === 'time' ? tl(`${v} a run`, `${v} par passage`) : tl(`${v} tokens`, `${v} tokens`)
  return tl(
    `Continue: it gets the same limit once more (${same}); its tokens keep adding up. Raise the limit: it carries on by itself, from what it already used. Take it as it is: the work is checked, then reviewed.`,
    `Continuer : elle a la même limite une fois de plus (${same}) ; ses tokens continuent de s’additionner. Relever la limite : elle reprend toute seule, à partir de ce qu’elle a déjà utilisé. Prendre telle quelle : le travail est vérifié, puis relu.`)
}
