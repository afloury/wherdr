// omp status line, on real screens (input field, open "Ask" box).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseOmpStatus } from '../server/utils/ompScreen'

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

describe('parseOmpStatus', () => {
  it('reads the status line and the gauges embedded in the field\'s rule', () => {
    const s = parseOmpStatus(fx('omp-idle-footer.txt'))!
    expect(s.line).toMatch(/^◒ Opus 5\.5 .* · 📁 ~\/wherdr · ⑂ /)
    expect(s.meters).toMatch(/^◫ [\d.]+%\/1M .* · ⏱ 5h \d+% /)
  })
  it('"Ask" box open: the status line below the box, no visible gauges', () => {
    expect(parseOmpStatus(fx('omp-ask-single.txt'))).toEqual({ line: '◒ Opus 5.5 👁 · 🗑 /tmp ↳ xero-app-service · ⑂ detached', meters: null })
  })
  it('nothing without a rule just above the last line (full-screen panel)', () => {
    expect(parseOmpStatus('Usage\n████ 40%\n\nEsc to close')).toBeNull()
  })
})
