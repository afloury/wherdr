import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { menuAsSheet } from '../app/utils/menuRoute'

describe('menuAsSheet', () => {
  it('floats only on a computer layout with a fine pointer', () => {
    expect(menuAsSheet({ desk: true, coarse: false })).toBe(false)
  })
  it('uses the bottom sheet on a narrow screen', () => {
    expect(menuAsSheet({ desk: false, coarse: false })).toBe(true)
    expect(menuAsSheet({ desk: false, coarse: true })).toBe(true)
  })
  it('uses the bottom sheet on a wide touch screen (tablet)', () => {
    expect(menuAsSheet({ desk: true, coarse: true })).toBe(true)
  })
})

// Regression guard: a context menu left enabled on touch screens opens
// Reka's floating menu on a long press instead of the bottom sheet.
describe('context menus in components', () => {
  const dir = join(__dirname, '../app/components')
  const files = readdirSync(dir).filter(f => f.endsWith('.vue'))
  const tags = files.flatMap(f => [...readFileSync(join(dir, f), 'utf8').matchAll(/<UContextMenu\b[^>]*>/g)].map(m => ({ f, tag: m[0] })))
  it('finds the context menus', () => {
    expect(tags.length).toBeGreaterThan(0)
  })
  it.each(tags)('$f disables its floating menu when menus are sheets', ({ tag }) => {
    expect(tag).toMatch(/:disabled="[^"]*sheetMenus/)
  })
})
