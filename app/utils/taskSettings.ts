import type { SettingGroup } from '#shared/taskSettings'
import { tl } from './i18n'

export function taskSettingGroupLabel(group: SettingGroup): string {
  switch (group) {
    case 'agent': return tl('Agent', 'Agent')
    case 'review': return tl('Review', 'Revue')
    case 'plan': return tl('Plan and attempts', 'Plan et essais')
    case 'limits': return tl('Limits', 'Limites')
    case 'merge': return tl('Merge', 'Fusion')
    case 'workspace': return tl('Workspace', 'Espace de travail')
    case 'other': return tl('Other settings', 'Autres réglages')
  }
}
export function taskSettingSource(place: string): string {
  switch (place) {
    case 'task': return tl('Task', 'Tâche')
    case 'repo': return tl('Repository', 'Dépôt')
    case 'you': return tl('You', 'Toi')
    case 'file': return tl('Repository file', 'Fichier du dépôt')
    case 'builtin': return tl('Default', 'Défaut')
    default: return place || tl('Source not provided', 'Provenance non renseignée')
  }
}
export function taskSettingLabel(name: string): string {
  switch (name) {
    case "worker.agent": return tl("Working agent", "Agent de travail")
    case "worker.effort": return tl("Reasoning effort", "Effort de raisonnement")
    case "worker.fast": return tl("Fast mode", "Mode rapide")
    case "worker.access": return tl("Access", "Accès")
    case "worker.instructions": return tl("Instructions", "Instructions")
    case "worker.fallback": return tl("Fallback agents", "Agents de secours")
    case "reviewer.agent": return tl("Reviewing agent", "Agent de revue")
    case "reviewer.effort": return tl("Review reasoning effort", "Effort de raisonnement de revue")
    case "reviewer.fast": return tl("Fast review mode", "Mode rapide de revue")
    case "reviewer.access": return tl("Reviewer access", "Accès du relecteur")
    case "reviewer.instructions": return tl("Review instructions", "Instructions de revue")
    case "reviewer.fallback": return tl("Fallback reviewers", "Relecteurs de secours")
    case "research.only": return tl("Research only", "Recherche seule")
    case "chat.only": return tl("Conversation only", "Conversation seule")
    case "plan.approve": return tl("Plan approval", "Approbation du plan")
    case "plan.agent": return tl("Planning agent", "Agent du plan")
    case "attempts.by": return tl("Number of attempts", "Nombre d’essais")
    case "attempts.pick": return tl("Attempt selection", "Sélection de l’essai")
    case "check.command": return tl("Check command", "Commande de vérification")
    case "check.again": return tl("Repeat checks", "Répétition des vérifications")
    case "check.timeout": return tl("Check timeout", "Délai des vérifications")
    case "review.when": return tl("When to review", "Quand relire")
    case "review.mustFix": return tl("Required fixes", "Corrections obligatoires")
    case "review.rounds": return tl("Review rounds", "Tours de revue")
    case "review.timeout": return tl("Review timeout", "Délai de revue")
    case "review.afterChat": return tl("Review after conversation", "Revue après conversation")
    case "review.evidence": return tl("Review evidence", "Preuves de revue")
    case "limit.time": return tl("Time limit", "Limite de temps")
    case "limit.tokens": return tl("Token limit", "Limite de tokens")
    case "merge.by": return tl("Who merges", "Qui fusionne")
    case "merge.method": return tl("Merge method", "Méthode de fusion")
    case "merge.pr": return tl("Pull request", "Pull request")
    case "merge.pushTimeout": return tl("Push timeout", "Délai du push")
    case "merge.checks": return tl("Merge checks", "Vérifications avant fusion")
    case "workspace.from": return tl("Starting branch", "Branche de départ")
    case "workspace.branch": return tl("Work branch pattern", "Format de la branche de travail")
    case "workspace.setup": return tl("Setup command", "Commande de préparation")
    case "workspace.include": return tl("Included files", "Fichiers inclus")
    case "workspace.teardown": return tl("Teardown command", "Commande de fin")
    case "workspace.cleanup": return tl("Workspace cleanup", "Nettoyage de l’espace de travail")
    default: return name
  }
}
