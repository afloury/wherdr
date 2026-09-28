// Chaque libellé passé à t('…') dans l'interface a sa version anglaise : sinon
// il reste en français quand l'app est en anglais.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const unquote = (s: string) => s.replace(/\\'/g, '\'')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return files(p)
    return /\.(vue|ts)$/.test(f) ? [p] : []
  })
}

describe('i18n', () => {
  it('traduit tous les libellés t() en anglais', () => {
    const dict = readFileSync('app/utils/i18n.ts', 'utf8')
    const keys = new Set([...dict.matchAll(/'((?:[^'\\]|\\.)*)'\s*:\s*['`]/g)].map(m => unquote(m[1]!)))
    const missing: string[] = []
    for (const f of [...files('app'), ...files('shared')]) {
      for (const m of readFileSync(f, 'utf8').matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'\s*[,)]/g)) {
        if (!keys.has(unquote(m[1]!))) missing.push(`${f}: ${unquote(m[1]!)}`)
      }
    }
    expect(missing).toEqual([])
  })
})
