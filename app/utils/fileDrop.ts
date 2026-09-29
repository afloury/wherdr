// Glisser-déposer de fichiers (Finder, explorateur) : le navigateur ouvrirait
// le fichier à la place de l'app. On ne s'occupe que des glissés qui portent
// des fichiers ; un texte glissé dans le champ garde son comportement normal.

export function carriesFiles(dt: { types?: ArrayLike<string> | null } | null | undefined): boolean {
  return Boolean(dt && dt.types && Array.from(dt.types).includes('Files'))
}

// Le champ de message n'accepte que des images (même chemin que le « + ») ;
// le reste est signalé par son nom.
export function splitDropped<F extends { type: string }>(files: F[]): { images: F[], refused: F[] } {
  const images: F[] = []
  const refused: F[] = []
  for (const f of files) (f.type.startsWith('image/') ? images : refused).push(f)
  return { images, refused }
}

// Compteur d'entrées/sorties : `dragleave` part à chaque enfant survolé.
export function dragDepth(depth: number, type: string): number {
  if (type === 'dragenter') return depth + 1
  if (type === 'dragleave') return Math.max(0, depth - 1)
  if (type === 'drop') return 0
  return depth
}
