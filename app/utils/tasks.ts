// Words of the Board (herdr-projects 1.x groups), in both languages.
import type { TaskGroup } from '../../shared/projectsTasks'
import { tl } from './i18n'

export function taskGroupLabel(g: TaskGroup): string {
  switch (g) {
    case 'needs': return tl('Needs you', 'À toi')
    case 'ready': return tl('Ready to approve', 'À approuver')
    case 'working': return tl('Working', 'En cours')
    case 'todo': return tl('To do', 'À faire')
    case 'done': return tl('Done', 'Fait')
  }
}

// Why a Board action is off on a machine whose board wherdr reads from its
// files (wherdr in a container): shown on hover of each disabled button.
export function readOnlyWhy(): string {
  return tl(
    'wherdr runs in a container here: the Board only reads herdr-projects. Do this from Herdr on the host, or move wherdr to the native service.',
    'wherdr tourne ici dans un conteneur : le Board ne fait que lire herdr-projects. Fais-le depuis Herdr sur l’hôte, ou passe wherdr en service natif.',
  )
}
