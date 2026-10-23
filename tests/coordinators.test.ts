import { describe, expect, it, vi } from 'vitest'
import { coordinatorDescription, coordinatorKind, coordinatorLabel, coordinatorUnavailable } from '../app/utils/coordinators'
import type { MachineTasks } from '../shared/projectsTasks'

const machine = (changes: Partial<MachineTasks> = {}): MachineTasks => ({ machine: '', status: 'ready', version: '1.2.1', tasks: [], ...changes })

describe('Board coordinator entry points', () => {
  it('uses herdr-projects names: Coordinator, <machine> coordinator, <repo> coordinator', () => {
    expect(coordinatorLabel({ kind: 'main' }, 'devbox')).toBe('Coordinator')
    expect(coordinatorLabel({ kind: 'machine' }, 'devbox')).toBe('devbox coordinator')
    expect(coordinatorLabel({ kind: 'machine' }, '')).toBe('Machine coordinator')
    expect(coordinatorLabel({ kind: 'project', repo: 'web' }, 'devbox')).toBe('web coordinator')
    expect(coordinatorDescription({ kind: 'main' })).toContain('every repo and machine')
    expect(coordinatorDescription({ kind: 'machine' })).toContain('its tasks and agents')
    expect(coordinatorDescription({ kind: 'machine' })).not.toMatch(/setup/i)
    expect(coordinatorDescription({ kind: 'project', repo: 'web' })).toContain('this repo')
  })

  it('only enables a fresh, reachable board', () => {
    expect(coordinatorUnavailable(machine())).toBe('')
    expect(coordinatorUnavailable(machine({ status: 'error', error: 'SSH unavailable' }))).toBe('SSH unavailable')
    expect(coordinatorUnavailable(machine({ stale: true }))).toContain('cannot be reached')
    expect(coordinatorUnavailable(machine({ error: 'Read failed' }))).toBe('Read failed')
    expect(coordinatorUnavailable(machine(), true)).toContain('Offline')
    for (const status of ['missing', 'old', 'disabled', 'error'] as const) {
      expect(coordinatorUnavailable(machine({ status }))).not.toBe('')
    }
  })
})

describe('Home coordinator kinds', () => {
  it('gives each kind its own icon and the Board name', () => {
    const top = coordinatorKind('top', true, 'devbox'), machine = coordinatorKind('machine', true, 'devbox'), project = coordinatorKind('project', true, 'devbox', 'web')
    expect(top).toMatchObject({ icon: 'i-lucide-square-kanban', name: 'Coordinator' })
    expect(machine).toMatchObject({ icon: 'i-lucide-server', name: 'devbox coordinator' })
    expect(project).toMatchObject({ icon: 'i-lucide-message-square-text', name: 'web coordinator' })
    for (const [level, to] of [['top', { kind: 'main' }], ['machine', { kind: 'machine' }], ['project', { kind: 'project', repo: 'web' }]] as const) {
      expect(coordinatorKind(level, true, 'devbox', 'web').name).toBe(coordinatorLabel(to, 'devbox'))
    }
    expect(coordinatorKind('machine', false).icon).toBe('i-lucide-laptop')
    expect(new Set([top.icon, machine.icon, project.icon]).size).toBe(3)
    expect(new Set([top.name, machine.name, project.name]).size).toBe(3)
    expect(top.hint).toBe(coordinatorDescription({ kind: 'main' }))
    expect(machine.hint).toBe(coordinatorDescription({ kind: 'machine' }))
  })
})

describe('French coordinator names', () => {
  it('says Coordinateur, Coordinateur · <machine>, Coordinateur · <dépôt>, never Configuration', async () => {
    vi.resetModules()
    vi.doMock('../app/utils/i18n', async (orig) => ({ ...(await orig<typeof import('../app/utils/i18n')>()), tl: (_en: string, fr: string) => fr }))
    const fr = await import('../app/utils/coordinators')
    expect(fr.coordinatorLabel({ kind: 'main' }, 'devbox')).toBe('Coordinateur')
    expect(fr.coordinatorLabel({ kind: 'machine' }, 'devbox')).toBe('Coordinateur · devbox')
    expect(fr.coordinatorLabel({ kind: 'project', repo: 'web' }, 'devbox')).toBe('Coordinateur · web')
    expect(fr.coordinatorKind('machine', true, 'devbox').name).toBe('Coordinateur · devbox')
    expect(fr.coordinatorDescription({ kind: 'machine' })).not.toMatch(/configuration/i)
    vi.doUnmock('../app/utils/i18n')
  })
})
