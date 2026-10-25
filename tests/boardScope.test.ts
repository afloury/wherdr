import { describe, expect, it } from 'vitest'
import { SCOPE_ALL, SCOPE_LOCAL, boardTabScope, boardMachineLabel, boardScopeItems, boardScopeMachine, boardScopeMachines, boardScopeValue, boardShownScope } from '../app/utils/boardScope'
import type { MachineGroup } from '../app/utils/machineBar'

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

describe('Board machine groups', () => {
  const groups: MachineGroup[] = [
    { id: '*group:home', name: 'Home', machines: ['', 'laptop'] },
    { id: '*group:work', name: 'Work', machines: ['devbox'] },
  ]

  it('lists All, then the groups under their heading, then each machine', () => {
    const items = boardScopeItems(['', 'laptop', 'devbox'], label, 'All machines', groups, 'Groups', 'Machines')
    expect(items).toEqual([
      { label: 'All machines', value: SCOPE_ALL },
      { type: 'separator' },
      { type: 'label', label: 'Groups' },
      { label: 'Home', value: '*group:home', icon: 'i-lucide-group' },
      { label: 'Work', value: '*group:work', icon: 'i-lucide-group' },
      { type: 'separator' },
      { type: 'label', label: 'Machines' },
      { label: 'Server', value: SCOPE_LOCAL },
      { label: 'Laptop', value: 'laptop' },
      { label: 'devbox', value: 'devbox' },
    ])
  })

  it('stays as before with no group', () => {
    expect(boardScopeItems(['', 'laptop'], label, 'All', [])).toEqual(boardScopeItems(['', 'laptop'], label, 'All'))
    expect(boardScopeItems(['', 'laptop'], label, 'All', []).every(i => !('type' in i))).toBe(true)
  })

  it('keeps a group ID through the select and the device\'s storage', () => {
    expect(boardScopeValue('*group:home')).toBe('*group:home')
    expect(boardScopeMachine('*group:home')).toBe('*group:home')
  })

  it('shows a group\'s machines, and every machine once the group is deleted', () => {
    const machines = ['', 'laptop', 'devbox']
    expect(boardShownScope('*group:home', machines, groups)).toBe('*group:home')
    expect(boardScopeMachines('*group:home', groups)).toEqual(['', 'laptop'])
    // Deleted in Settings: All machines.
    expect(boardShownScope('*group:home', machines, groups.slice(1))).toBe(SCOPE_ALL)
    // Edited in Settings: its machines now.
    const edited = [{ ...groups[0]!, machines: ['devbox'] }]
    expect(boardScopeMachines('*group:home', edited)).toEqual(['devbox'])
    // An empty group stays chosen and shows nothing.
    expect(boardScopeMachines('*group:none', [{ id: '*group:none', name: 'None', machines: [] }])).toEqual([])
  })

  it('still filters on one machine, and falls back to All when it went away', () => {
    expect(boardShownScope('laptop', ['', 'laptop'], groups)).toBe('laptop')
    expect(boardScopeMachines('laptop', groups)).toEqual(['laptop'])
    expect(boardShownScope('gone', ['', 'laptop'], groups)).toBe(SCOPE_ALL)
    expect(boardShownScope(SCOPE_ALL, [], groups)).toBe(SCOPE_ALL)
    expect(boardScopeMachines(SCOPE_ALL, groups)).toBeNull()
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

describe('Board scope follows the sidebar tab', () => {
  const groups = [{ id: '*group:personal', name: 'Personal', machines: ['', 'laptop'] }]
  const machines = ['', 'laptop', 'work']

  it('opens with each tab, including the local machine and groups', () => {
    for (const tab of ['', 'work', '*group:personal', SCOPE_ALL]) {
      expect(boardTabScope().update(tab, machines, groups)).toBe(tab)
    }
  })

  it('preserves manual choices during refreshes and resets on the next tab', () => {
    const selection = boardTabScope()
    expect(selection.update('*group:personal', machines, groups)).toBe('*group:personal')
    selection.manual(SCOPE_ALL)
    expect(selection.update('*group:personal', [...machines], [...groups])).toBe(SCOPE_ALL)
    expect(selection.update('work', machines, groups)).toBe('work')
    expect(selection.update('*group:personal', machines, groups)).toBe('*group:personal')
  })

  it('keeps the choice when the Board is opened again on the same tab', () => {
    const selection = boardTabScope()
    selection.update('work', machines, groups)
    selection.manual('laptop')
    // A new Board view reads the same tab again.
    expect(selection.update('work', machines, groups)).toBe('laptop')
  })

  it('waits for known Board machines without overriding a manual choice', () => {
    const selection = boardTabScope()
    expect(selection.update('work', [], groups)).toBeUndefined()
    expect(selection.update('work', machines, groups)).toBe('work')
    const manual = boardTabScope()
    manual.update('work', [], groups)
    manual.manual('')
    expect(manual.update('work', machines, groups)).toBe('')
  })

  it('keeps the existing scope for no tab or a tab without Board machines', () => {
    const selection = boardTabScope()
    for (const tab of [null, 'unknown', '*group:empty', '*group:personal']) {
      expect(selection.update(tab, ['work'], [...groups, { id: '*group:empty', name: 'Empty', machines: [] }])).toBeUndefined()
    }
  })
})
