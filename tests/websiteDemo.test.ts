import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { gridNeighbours, parseGridVariant } from '../website/app/utils/grid'
import { INSTALL_OUTPUT } from '../website/app/utils/installDemo'

describe('website grid variants', () => {
  it('accepts only /grid/1 to /grid/4', () => {
    expect(['1', '2', '3', '4'].map(parseGridVariant)).toEqual([1, 2, 3, 4])
    for (const bad of ['0', '5', '01', '1.5', '', 'x', undefined, null, 3]) expect(parseGridVariant(bad)).toBeNull()
    expect(parseGridVariant(['2', '3'])).toBe(2)
  })

  it('wraps previous and next around the four variants', () => {
    expect(gridNeighbours(1)).toEqual({ prev: 4, next: 2 })
    expect(gridNeighbours(4)).toEqual({ prev: 3, next: 1 })
  })
})

describe('install demo', () => {
  // Every step / ok line the site replays must be one the real script prints,
  // with the shell variables filled in.
  const script = readFileSync(new URL('../website/public/install', import.meta.url), 'utf8')
  const templates = [...script.matchAll(/(?:^|\s)(step|ok) "((?:[^"\\]|\\.)*)"/gm)].map(([, kind, text]) => ({
    kind,
    re: new RegExp(`^${text!.split(/\$\(.*?\)|\$\{?\w+\}?/).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+')}$`),
  }))

  it.each(INSTALL_OUTPUT.filter(l => l.kind === 'step' || l.kind === 'ok'))('$kind "$text" comes from public/install', (line) => {
    expect(templates.some(t => t.kind === line.kind && t.re.test(line.text))).toBe(true)
  })
})
