// Words of the Board settings screen (BoardSettings.vue), English and French.
import type { BoardSettingTheme, BoardSettingsTab, SettingWarning } from '#shared/boardSettings'
import { tl } from './i18n'
import { taskSettingLabel } from './taskSettings'

export function boardSettingsTabLabel(tab: BoardSettingsTab): string {
  switch (tab) {
    case 'machine': return tl('Machine', 'Machine')
    case 'defaults': return tl('Defaults', 'Par défaut')
    case 'repo': return tl('Repositories', 'Dépôts')
  }
}
export function boardSettingsTabHint(tab: BoardSettingsTab): string {
  switch (tab) {
    case 'machine': return tl('The board itself, its Coordinator and its Watcher. Yours only, for this machine.', 'Le board lui-même, son Coordinateur et son Veilleur. À toi seul, pour cette machine.')
    case 'defaults': return tl('Your values for every task of this machine. A repository’s entry or a task can say otherwise.', 'Tes valeurs pour toutes les tâches de cette machine. L’entrée d’un dépôt ou une tâche peut dire autrement.')
    case 'repo': return tl('Your entry for one repository: what differs there from your defaults.', 'Ton entrée pour un dépôt : ce qui y diffère de tes valeurs par défaut.')
  }
}

export function boardSettingThemeLabel(theme: BoardSettingTheme): string {
  switch (theme) {
    case 'worker': return tl('Who works', 'Qui travaille')
    case 'review': return tl('Review', 'Relecture')
    case 'plan': return tl('Plan', 'Plan')
    case 'attempts': return tl('Attempts', 'Essais')
    case 'merge': return tl('Merge', 'Fusion')
    case 'limits': return tl('Limits', 'Limites')
    case 'workspace': return tl('Workspace', 'Espace de travail')
    case 'check': return tl('Check', 'Contrôle')
    case 'modes': return tl('Research / Conversation', 'Recherche / Conversation')
    case 'board': return tl('Board', 'Board')
    case 'coordinator': return tl('Coordinator', 'Coordinateur')
    case 'autopilot': return tl('Autopilot', 'Pilote automatique')
    case 'watcher': return tl('Watcher', 'Veilleur')
    case 'voice': return tl('Voice calls', 'Appels vocaux')
    case 'other': return tl('Other settings', 'Autres réglages')
  }
}

const MACHINE_LABELS: Record<string, [string, string]> = {
  'board.agents': ['Agents at once', 'Agents en même temps'],
  'board.diskFree': ['Free disk to keep', 'Disque libre à garder'],
  'board.oldBuilds': ['Old builds kept (days)', 'Anciens builds gardés (jours)'],
  'board.machines': ['Other machines', 'Autres machines'],
  'board.open': ['What the board key opens', 'Ce qu’ouvre la touche du board'],
  'board.notify': ['Notification', 'Notification'],
  'board.keys': ['Your own keys', 'Tes propres touches'],
  'board.webUi': ['Board in the herdr web UI', 'Board dans l’interface web de herdr'],
  'board.theme': ['Board colours', 'Couleurs du board'],
  'coordinator.agent': ['Coordinator agent', 'Agent du Coordinateur'],
  'coordinator.effort': ['Coordinator effort', 'Effort du Coordinateur'],
  'coordinator.fast': ['Coordinator fast mode', 'Mode rapide du Coordinateur'],
  'coordinator.access': ['Coordinator access', 'Accès du Coordinateur'],
  'coordinator.instructions': ['Coordinator instructions', 'Instructions du Coordinateur'],
  'watcher.agent': ['Watcher model', 'Modèle du Veilleur'],
  'watcher.every': ['Watcher interval', 'Intervalle du Veilleur'],
  'repo.key': ['Repository key', 'Clé du dépôt'],
}
// The plain label; the setting's own name is always shown under it.
export function boardSettingLabel(name: string): string {
  const own = MACHINE_LABELS[name]
  return own ? tl(own[0], own[1]) : taskSettingLabel(name)
}

export function settingWarningText(warning: SettingWarning, repo: string): string {
  const where = repo ? tl(` in ${repo}`, ` dans ${repo}`) : ''
  switch (warning) {
    case 'mergeItself': return tl(`Work${where} will merge by itself, without your yes. Tasks already reviewed will merge right away.`, `Le travail${where} fusionnera tout seul, sans ton accord. Les tâches déjà relues fusionneront tout de suite.`)
    case 'mayMergeItself': return tl(`merge.by goes back to its inherited value${where}. If that value is itself, tasks already reviewed will merge right away.`, `merge.by revient à sa valeur héritée${where}. Si cette valeur est itself, les tâches déjà relues fusionneront tout de suite.`)
    case 'mergeNoChecks': return tl(`Pull requests${where} will merge without waiting for their GitHub checks, from the next merge on.`, `Les pull requests${where} fusionneront sans attendre leurs vérifications GitHub, dès la prochaine fusion.`)
    case 'noReview': return tl(`Finished work${where} will no longer be reviewed, starting with the tasks finishing now.`, `Le travail fini${where} ne sera plus relu, à commencer par les tâches qui finissent maintenant.`)
    case 'boardAgents': return tl('This changes how many agents work at once on this machine, right now: tasks in the queue may start at once.', 'Cela change tout de suite le nombre d’agents qui travaillent en même temps sur cette machine : des tâches en file peuvent démarrer aussitôt.')
    case 'noCoordinator': return tl('This machine will have no Coordinator: the board’s chat box stops answering.', 'Cette machine n’aura plus de Coordinateur : la zone de discussion du board ne répondra plus.')
  }
}
