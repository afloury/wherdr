// Réglages : sections et bouton Retour.

export const SETTINGS_SECTIONS = ['appearance', 'conversation', 'terminal', 'agents', 'plugins', 'notifications', 'security', 'desktop', 'about'] as const
export type SettingsSection = typeof SETTINGS_SECTIONS[number]

// Téléphone : une section ouverte est une entrée d'historique (?section=…), au-dessus
// de la liste : Retour la dépile (comme le bouton Retour d'Android) ; ouverte
// directement (lien, rechargement), sans liste dessous, elle est remplacée par la
// liste. Sinon on revient à la vue d'où l'on vient (entrée précédente de
// l'historique du routeur), ou à l'accueil quand les Réglages ont été ouverts
// directement.
export function settingsBack(opts: { desk: boolean, section: string | null, historyBack: unknown }): 'list' | 'history' | 'home' {
  const b = opts.historyBack
  if (!opts.desk && opts.section) return b === '/settings' ? 'history' : 'list'
  return typeof b === 'string' && b.startsWith('/') && !b.startsWith('/settings') ? 'history' : 'home'
}
