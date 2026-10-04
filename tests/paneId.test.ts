import { describe, expect, it } from 'vitest'
import { herdrPaneId, paneIdLine } from '../app/utils/paneId'

describe('Herdr ID of a pane', () => {
  it('local: copied as is', () => {
    expect(herdrPaneId('w1Z:p1')).toBe('w1Z:p1')
    expect(paneIdLine('w1Z:p1', 'Pi')).toBe('w1Z:p1')
  })
  it('remote: without the machine prefix, machine shown', () => {
    expect(herdrPaneId('0a1b2c3d~w3:p2')).toBe('w3:p2')
    expect(paneIdLine('0a1b2c3d~w3:p2', 'Machine B')).toBe('w3:p2 · Machine B')
    expect(paneIdLine('0a1b2c3d~w3:p2')).toBe('w3:p2')
  })
})
