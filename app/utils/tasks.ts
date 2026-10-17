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
