// Panneau « Projet » : quand lire l'état du projet (fonction pure, testée dans
// tests/projectRefresh.test.ts).
//  - `poll` : panneau visible, on lit tout de suite puis on sonde ;
//  - `probe` : panneau caché, on lit une fois pour savoir s'il faut montrer
//    l'onglet / le bouton (disponibilité encore inconnue) ;
//  - `none` : rien (pas un coordinateur, herdr-projects absent, page cachée,
//    ou état hors ligne : au rechargement, l'app montre d'abord le dernier état
//    gardé ; la lecture part dès que l'état en direct arrive).
export interface RefreshInput {
  coordinator: boolean
  offline: boolean
  visible: boolean
  pageVisible: boolean
  available: boolean | null
}
export type RefreshMode = 'poll' | 'probe' | 'none'

export function refreshMode(s: RefreshInput): RefreshMode {
  if (!s.coordinator || s.offline || s.available === false || !s.pageVisible) return 'none'
  if (s.visible) return 'poll'
  return s.available === null ? 'probe' : 'none'
}
