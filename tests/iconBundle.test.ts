import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { glob } from 'tinyglobby'
import { IconUsageScanner } from '@nuxt/icon/utils'
import { icons as lucide } from '@iconify-json/lucide'
import { ICON_SCAN_GLOBS } from '../shared/iconScan'

// Icons are bundled at build time (no icon API at runtime): a name the scan does
// not see, or one that is not in the collection, renders as an empty square.
describe('icon bundle', () => {
  it('scans every source file that names a lucide icon', async () => {
    const files = await glob(['app/**/*.{vue,ts}', 'shared/**/*.ts'])
    const used = new Set<string>()
    for (const file of files)
      for (const m of readFileSync(file, 'utf8').matchAll(/\bi-lucide-([a-z0-9]+(?:-[a-z0-9]+)*)/g)) used.add(`lucide:${m[1]}`)
    expect(used.size).toBeGreaterThan(100)
    expect(used).toContain('lucide:stethoscope')

    const scanned = new Set<string>()
    await new IconUsageScanner({ globInclude: ICON_SCAN_GLOBS }).scanFiles(process.cwd(), scanned)
    expect([...used].filter(name => !scanned.has(name))).toEqual([])
  })

  it('names only icons that exist in the lucide collection', async () => {
    const scanned = new Set<string>()
    await new IconUsageScanner({ globInclude: ICON_SCAN_GLOBS }).scanFiles(process.cwd(), scanned)
    const known = new Set([...Object.keys(lucide.icons), ...Object.keys(lucide.aliases ?? {})])
    const missing = [...scanned].filter(name => name.startsWith('lucide:') && !known.has(name.slice('lucide:'.length)))
    expect(missing).toEqual([])
  })
})
