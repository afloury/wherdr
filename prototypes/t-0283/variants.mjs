// t-0283 mock-ups (throwaway): the variants, as titled on the boards and in index.html.
export const VARIANTS = [
  { id: '0', name: 'Actuel (1.3.2)', desktop: 'Question au milieu : étiquette pâle. Question finale et points : rien au repos.', phone: 'Étiquettes visibles sur les questions, rien pour les points.', gesture: null },
  { id: 'A', name: 'Étiquette partout', desktop: 'Survol d’un point : étiquette « ↳ Discuter » en pointillé.', phone: 'Geste : glisser le point vers la gauche.', gesture: 'Glissement en cours' },
  { id: 'B', name: 'Icône seule', desktop: 'Survol d’un point : « ↳ » gris en fin de point.', phone: 'Un « ↳ » pâle en fin de chaque point, toujours là.', gesture: 'Après un toucher : ✓ et citation' },
  { id: 'C', name: 'Repères dans la marge', desktop: 'Survol d’un point : « + » dans la marge, le point se teinte.', phone: 'Colonne de repères à droite du texte.', gesture: 'Après un toucher : ✓ et citation' },
  { id: 'D', name: 'Le texte est le bouton', desktop: 'Survol d’un point : il se teinte, un clic le cite.', phone: 'Geste : appui long sur un point.', gesture: 'Appui long : barre flottante' },
  { id: 'E', name: 'Barre sous le message', desktop: 'Survol d’une ligne de la barre : la question s’allume dans le texte.', phone: 'Même barre, sous le message.', gesture: 'Mode « citer un point »' },
]
