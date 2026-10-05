// Pixel grids of the brand: the ram (same grid as the app logo,
// app/components/AppLogo.vue) and the "wherdr" wordmark drawn in a 7-row
// pixel font, so both share the same pixel size and baseline.

export const RAM = [
  '.###........###.',
  '#...#.####.#...#',
  '#.#..######..#.#',
  '#..#.######.#..#',
  '.##..#.##.#..##.',
  '.....######.....',
  '......####......',
]

const GLYPHS: Record<string, string[]> = {
  w: ['.....', '.....', '#...#', '#...#', '#.#.#', '#.#.#', '.#.#.'],
  h: ['#....', '#....', '####.', '#...#', '#...#', '#...#', '#...#'],
  e: ['.....', '.....', '.###.', '#...#', '#####', '#....', '.###.'],
  r: ['.....', '.....', '#.##.', '##..#', '#....', '#....', '#....'],
  d: ['....#', '....#', '.####', '#...#', '#...#', '#...#', '.####'],
}

/** Lays out `text` in the pixel font, one blank column between letters. */
export function pixelText(text: string): string[] {
  const rows = Array.from({ length: 7 }, () => [] as string[])
  ;[...text].forEach((ch, i) => {
    const g = GLYPHS[ch]
    if (!g) throw new Error(`no pixel glyph for "${ch}"`)
    rows.forEach((row, y) => row.push((i ? '.' : '') + g[y]))
  })
  return rows.map(r => r.join(''))
}

export interface Pixel { x: number, y: number, delay: number }

/**
 * Lit pixels of a grid with their boot delay: row first (a scanline sweeping
 * top to bottom), with a little jitter per column. Same timing for every grid
 * of the same height, so the ram and the wordmark sweep as one.
 */
export function gridPixels(grid: string[]): Pixel[] {
  return grid.flatMap((row, y) => [...row].flatMap((c, x) => c === '#'
    ? [{ x, y, delay: y * 70 + ((x * 37) % 5) * 18 }]
    : []))
}
