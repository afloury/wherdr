import { describe, expect, it } from 'vitest'
import { herdrPaneId, paneIdLine } from '../app/utils/paneId'

describe('ID Herdr d’un pane', () => {
  it('local : copié tel quel', () => {
    expect(herdrPaneId('w1Z:p1')).toBe('w1Z:p1')
    expect(paneIdLine('w1Z:p1', 'Pi')).toBe('w1Z:p1')
  })
  it('distant : sans le préfixe de machine, machine indiquée', () => {
    expect(herdrPaneId('f27df2ea~w3:p2')).toBe('w3:p2')
    expect(paneIdLine('f27df2ea~w3:p2', 'Machine B')).toBe('w3:p2 · Machine B')
    expect(paneIdLine('f27df2ea~w3:p2')).toBe('w3:p2')
  })
})
