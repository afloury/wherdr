// Écrans d'attente des agents (cf. server/utils/waitScreen.ts) : ce que l'app
// en montre. Les touches ne partent que sur un bouton de l'utilisateur.
import type { Pane, WaitAction, WaitKind, WaitScreen } from '../../shared/types'
import { language } from './i18n'

// Écran reconnu (hooks, confiance, connexion, mise à jour) : l'agent attend
// l'utilisateur, même si Herdr le voit « idle ». Un écran inconnu (`other`)
// n'est montré que tant qu'il n'y a pas de conversation (ChatView).
export function knownScreen(p: Pane | null | undefined): WaitScreen | null {
  return p && p.screen && p.screen.kind !== 'other' && p.status !== 'working' ? p.screen : null
}

const KEYS: Record<string, [string, string]> = { enter: ['Entrée', 'Enter'], esc: ['Échap', 'Esc'], tab: ['Tab', 'Tab'] }
// Libellés anglais des légendes de Codex / Claude Code.
const LABELS: Record<string, [string, string]> = {
  'trust all': ['Tout approuver', 'Trust all'],
  'review': ['Revoir', 'Review'],
  'close': ['Fermer', 'Close'],
  'skip': ['Passer', 'Skip'],
  'continue': ['Continuer', 'Continue'],
  'back': ['Retour', 'Back'],
  'go back': ['Retour', 'Go back'],
  'confirm': ['Confirmer', 'Confirm'],
  'cancel': ['Annuler', 'Cancel'],
  'save': ['Enregistrer', 'Save'],
  'exit': ['Quitter', 'Exit'],
  'quit': ['Quitter', 'Quit'],
  'select': ['Choisir', 'Select'],
  'apply': ['Appliquer', 'Apply'],
  'dismiss': ['Ignorer', 'Dismiss'],
}
const pick = (pair: [string, string], en: boolean) => pair[en ? 1 : 0]

export function screenKeyName(key: string, en = language === 'en'): string {
  return KEYS[key] ? pick(KEYS[key]!, en) : key
}

// « Tout approuver », « Revoir » ; libellé inconnu : tel quel, capitalisé.
export function screenActionText(a: WaitAction, en = language === 'en'): string {
  const l = LABELS[a.label.toLowerCase()]
  return l ? pick(l, en) : a.label[0]!.toUpperCase() + a.label.slice(1)
}

// « Tout approuver (t) », « Revoir (Entrée) ».
export function screenActionLabel(a: WaitAction, en = language === 'en'): string {
  return `${screenActionText(a, en)} (${screenKeyName(a.key, en)})`
}

// Résumé pour la carte de l'accueil et le plan d'un onglet.
export function screenSummary(s: WaitScreen, en = language === 'en'): string | null {
  const sums: Partial<Record<WaitKind, [string, string]>> = {
    hooks: ['Hooks à approuver', 'Hooks to review'],
    trust: ['Confiance du dossier demandée', 'Folder trust requested'],
    login: ['Connexion demandée', 'Sign-in required'],
    update: ['Mise à jour proposée', 'Update available'],
  }
  const sum = sums[s.kind]
  return sum ? pick(sum, en) : s.title
}

// Une ligne d'explication par écran reconnu.
export function screenNote(kind: WaitKind, en = language === 'en'): string | null {
  const notes: Partial<Record<WaitKind, [string, string]>> = {
    hooks: [
      'Des hooks (commandes lancées automatiquement à certains moments : avant un outil, au démarrage…) sont nouveaux ou ont changé : ils ne tournent qu’une fois approuvés.',
      'Hooks (commands run automatically at set moments: before a tool, at startup…) are new or changed: they only run once you trust them.',
    ],
    trust: [
      'L’agent demande s’il peut lire, modifier et exécuter les fichiers de ce dossier.',
      'The agent asks whether it may read, edit and run the files in this folder.',
    ],
    login: [
      'L’agent n’est pas connecté. La connexion s’ouvre sur la machine de l’agent : termine-la dans le terminal.',
      'The agent is not signed in. Sign-in opens on the agent’s machine: finish it in the terminal.',
    ],
    update: [
      'Une nouvelle version de l’agent est disponible.',
      'A new version of the agent is available.',
    ],
  }
  const n = notes[kind]
  return n ? pick(n, en) : null
}
