import { afterEach, describe, expect, it } from 'vitest'
import { attachQuoteMirror } from '~/utils/quoteMirror'

const cleanup: (() => void)[] = []
afterEach(() => { cleanup.splice(0).forEach(f => f()) })

function field(value: string) {
  const host = document.createElement('div')
  const ta = document.createElement('textarea')
  ta.value = value
  host.append(ta)
  document.body.append(host)
  const m = attachQuoteMirror(ta)
  cleanup.push(() => { m.destroy(); host.remove() })
  return { host, ta, m, rows: () => [...host.querySelectorAll('.qm-mirror > div > div')] as HTMLElement[] }
}

describe('attachQuoteMirror (native field)', () => {
  it('draws one row per line, the "> " lines as tokens, behind an unchanged field', () => {
    const draft = '> Tea or coffee?\nCoffee.\n> And your series?\nLost!'
    const { ta, host, rows } = field(draft)
    expect(rows().map(r => r.className)).toEqual(['qm-q first last', '', 'qm-q first last', ''])
    expect(rows().map(r => r.textContent)).toEqual(['> Tea or coffee?', 'Coffee.', '> And your series?', 'Lost!'])
    expect(host.firstElementChild?.className).toBe('qm-mirror')
    expect(ta.classList.contains('qm-on')).toBe(true)
    // What is sent is the field's text: the mirror never touches it.
    expect(ta.value).toBe(draft)
  })

  it('follows typing and text set from script', () => {
    const { ta, m, rows } = field('> Q?\n')
    expect(rows()).toHaveLength(2)
    ta.value = '> Q?\nA\n> R?\nB'
    ta.dispatchEvent(new Event('input'))
    expect(rows().filter(r => r.classList.contains('qm-q'))).toHaveLength(2)
    ta.value = 'plain'
    m.render()
    expect(rows().map(r => r.className)).toEqual([''])
  })

  it('leaves the field as it was once destroyed', () => {
    const { ta, host, m } = field('> Q?\nA')
    m.destroy()
    expect(host.querySelector('.qm-mirror')).toBeNull()
    expect(ta.classList.contains('qm-on')).toBe(false)
    expect(host.classList.contains('qm-host')).toBe(false)
  })
})
