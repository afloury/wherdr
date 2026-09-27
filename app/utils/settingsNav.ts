// Réglages : sections et bouton Retour.

export const SETTINGS_SECTIONS = ['appearance', 'conversation', 'terminal', 'agents', 'notifications', 'security', 'desktop', 'about'] as const
export type SettingsSection = typeof SETTINGS_SECTIONS[number]

// Téléphone : une section ouverte revient à la liste ; sinon on revient à la
// vue d'où l'on vient (entrée précédente de l'historique du routeur), ou à
// l'accueil quand les Réglages ont été ouverts directement (lien, rechargement).
export function settingsBack(opts: { desk: boolean, section: string | null, historyBack: unknown }): 'list' | 'history' | 'home' {
  if (!opts.desk && opts.section) return 'list'
  const b = opts.historyBack
  return typeof b === 'string' && b.startsWith('/') && !b.startsWith('/settings') ? 'history' : 'home'
}
