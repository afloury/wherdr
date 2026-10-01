// Thumbnails of a message: every image stays reachable. Up to `max` tiles;
// beyond that the last tile becomes "+N" and opens the viewer on the first hidden one.
export const THUMB_MAX = 9

export function thumbLayout(count: number, max = THUMB_MAX): { shown: number, more: number } {
  const n = Math.max(0, Math.floor(count))
  if (n <= max) return { shown: n, more: 0 }
  return { shown: max - 1, more: n - (max - 1) }
}

// Viewer navigation: next/previous image, clamped to the set (no wrap).
export function stepImage(index: number, delta: number, count: number): number {
  if (count <= 0) return 0
  return Math.min(count - 1, Math.max(0, index + delta))
}
