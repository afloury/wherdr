// Background grid variants, compared on /grid/1…5 (0 = the current flat grid).
export type GridVariant = 0 | 1 | 2 | 3 | 4 | 5

export const GRID_VARIANTS: { n: Exclude<GridVariant, 0>, name: string }[] = [
  { n: 1, name: 'Lamp' },
  { n: 2, name: 'Travelling packets' },
  { n: 3, name: 'Hero perspective' },
  { n: 4, name: 'Dotted intersections' },
  { n: 5, name: 'Dots and packets' },
]

// Grid cell, in CSS pixels (same as .grid-bg in main.css).
export const GRID_CELL = 64

/** Parses a /grid/:n route parameter; null when it is not a variant. */
export function parseGridVariant(raw: unknown): Exclude<GridVariant, 0> | null {
  const s = Array.isArray(raw) ? raw[0] : raw
  if (typeof s !== 'string' || !/^[1-5]$/.test(s)) return null
  return Number(s) as Exclude<GridVariant, 0>
}

/** Previous and next variant numbers, wrapping around 1…5. */
export function gridNeighbours(n: number): { prev: number, next: number } {
  const count = GRID_VARIANTS.length
  return { prev: ((n - 2 + count) % count) + 1, next: (n % count) + 1 }
}
