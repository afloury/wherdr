// Agents' waiting screens (see server/utils/waitScreen.ts): what the app
// shows of them. Keys are only sent on a user's button press.
import type { InteractiveMenu, Pane, WaitAction, WaitKind, WaitScreen } from '../../shared/types'
import { language } from './i18n'

// Recognized screen (hooks, trust, login, update): the agent is waiting for
// the user, even if Herdr sees it as "idle". An unknown screen (`other`)
// is only shown while there is no conversation (ChatView).
export function knownScreen(p: Pane | null | undefined): WaitScreen | null {
  return p && p.screen && p.screen.kind !== 'other' && p.status !== 'working' ? p.screen : null
}

const KEYS: Record<string, [string, string]> = {
  enter: ['Entrée', 'Enter'], esc: ['Échap', 'Esc'], tab: ['Tab', 'Tab'], space: ['Espace', 'Space'], left: ['←', '←'], right: ['→', '→'],
}
// English labels of the Codex / Claude Code legends.
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
  // Menus de Claude Code (/resume, /model…).
  'show all projects': ['Tous les projets', 'All projects'],
  'only show current branch': ['Branche courante seulement', 'Current branch only'],
  'preview': ['Aperçu', 'Preview'],
  'set as default': ['Définir par défaut', 'Set as default'],
  'use this session only': ['Cette session seulement', 'This session only'],
  'resume': ['Reprendre', 'Resume'],
  'clear': ['Effacer', 'Clear'],
  '← switch': ['Onglet précédent', 'Previous tab'],
  '→ switch': ['Onglet suivant', 'Next tab'],
}
const pick = (pair: [string, string], en: boolean) => pair[en ? 1 : 0]

export function screenKeyName(key: string, en = language === 'en'): string {
  if (KEYS[key]) return pick(KEYS[key]!, en)
  // "ctrl+a" → "Ctrl+A".
  const m = key.match(/^ctrl\+(\w)$/)
  return m ? `Ctrl+${m[1]!.toUpperCase()}` : key
}

// Summary of an open interactive menu for the home card.
export function menuSummary(m: InteractiveMenu, en = language === 'en'): string {
  return m.title ? `${pick(['Menu', 'Menu'], en)} · ${m.title}` : pick(['Menu ouvert', 'Menu open'], en)
}

// "Tout approuver", "Revoir"; unknown label: as is, capitalized.
export function screenActionText(a: WaitAction, en = language === 'en'): string {
  const l = LABELS[a.label.toLowerCase()]
  return l ? pick(l, en) : a.label[0]!.toUpperCase() + a.label.slice(1)
}

// "Tout approuver (t)", "Revoir (Entrée)".
export function screenActionLabel(a: WaitAction, en = language === 'en'): string {
  return `${screenActionText(a, en)} (${screenKeyName(a.key, en)})`
}

// Summary for the home card and a tab's plan.
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

// One line of explanation per recognized screen.
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
