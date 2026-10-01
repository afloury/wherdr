// Ligne d'état d'omp, sur des écrans réels (champ de saisie, boîte « Ask » ouverte).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseOmpStatus } from '../server/utils/ompScreen'

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

describe('parseOmpStatus', () => {
  it('lit la ligne d’état et les jauges incrustées dans le trait du champ', () => {
    const s = parseOmpStatus(fx('omp-idle-footer.txt'))!
    expect(s.line).toMatch(/^◒ Opus 5\.5 .* · 📁 ~\/wherdr · ⑂ /)
    expect(s.meters).toMatch(/^◫ [\d.]+%\/1M .* · ⏱ 5h \d+% /)
  })
  it('boîte « Ask » ouverte : la ligne d’état sous la boîte, sans jauges visibles', () => {
    expect(parseOmpStatus(fx('omp-ask-single.txt'))).toEqual({ line: '◒ Opus 5.5 👁 · 🗑 /tmp ↳ xero-app-service · ⑂ detached', meters: null })
  })
  it('rien sans trait juste au-dessus de la dernière ligne (panneau plein écran)', () => {
    expect(parseOmpStatus('Usage\n████ 40%\n\nEsc to close')).toBeNull()
  })
})
