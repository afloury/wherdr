import { describe, expect, it } from 'vitest'
import { SCOPE_ALL, SCOPE_LOCAL, boardMachineLabel, boardScopeItems, boardScopeMachine, boardScopeValue } from '../app/utils/boardScope'

const labels: Record<string, string> = { '': 'Server', laptop: 'Laptop', devbox: 'devbox' }
const label = (m: string) => labels[m] ?? m

describe('Board machine filter', () => {
  it('lists every machine, the local one included, with its label', () => {
    const items = boardScopeItems(['', 'laptop', 'devbox'], label, 'All machines')
    expect(items.map(i => i.label)).toEqual(['All machines', 'Server', 'Laptop', 'devbox'])
    expect(items.map(i => i.value)).toEqual([SCOPE_ALL, SCOPE_LOCAL, 'laptop', 'devbox'])
  })

  it('never gives an item an empty value (a select drops it)', () => {
    for (const machines of [[''], ['laptop', ''], ['', 'laptop', 'devbox']]) {
      const values = boardScopeItems(machines, label, 'All').map(i => i.value)
      expect(values).not.toContain('')
      expect(new Set(values).size).toBe(values.length)
    }
  })

  it('keeps Herdr\'s order, local machine wherever it is', () => {
    expect(boardScopeItems(['laptop', ''], label, 'All').map(i => i.label)).toEqual(['All', 'Laptop', 'Server'])
  })

  it('turns values back into machine keys', () => {
    expect(boardScopeMachine(boardScopeValue(''))).toBe('')
    expect(boardScopeMachine(boardScopeValue('laptop'))).toBe('laptop')
    expect(boardScopeMachine(SCOPE_ALL)).toBe(SCOPE_ALL)
    // Nothing stored yet, or storage unavailable: every machine.
    expect(boardScopeMachine(null)).toBe(SCOPE_ALL)
    expect(boardScopeMachine('')).toBe(SCOPE_ALL)
  })
})

describe('Board machine names', () => {
  it('uses Herdr\'s name, else this machine\'s name for the local one, else the key', () => {
    expect(boardMachineLabel('laptop', 'Laptop', 'Server')).toBe('Laptop')
    expect(boardMachineLabel('', '', 'Server')).toBe('Server')
    expect(boardMachineLabel('', 'This machine', 'Server')).toBe('This machine')
    expect(boardMachineLabel('mb', '', 'Server')).toBe('mb')
  })
})
