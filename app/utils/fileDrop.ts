// Drag and drop of files (Finder, file explorer): the browser would open
// the file instead of the app. We only deal with drags that carry
// files; text dragged into the field keeps its normal behaviour.

export function carriesFiles(dt: { types?: ArrayLike<string> | null } | null | undefined): boolean {
  return Boolean(dt && dt.types && Array.from(dt.types).includes('Files'))
}

// The message field only accepts images (same path as the "+");
// the rest is reported by its name.
export function splitDropped<F extends { type: string }>(files: F[]): { images: F[], refused: F[] } {
  const images: F[] = []
  const refused: F[] = []
  for (const f of files) (f.type.startsWith('image/') ? images : refused).push(f)
  return { images, refused }
}

// Enter/leave counter: `dragleave` fires for each child hovered.
export function dragDepth(depth: number, type: string): number {
  if (type === 'dragenter') return depth + 1
  if (type === 'dragleave') return Math.max(0, depth - 1)
  if (type === 'drop') return 0
  return depth
}
