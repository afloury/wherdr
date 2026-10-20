import { describe, expect, it } from 'vitest'
import { coordinatorDescription, coordinatorLabel, coordinatorUnavailable } from '../app/utils/coordinators'
import type { MachineTasks } from '../shared/projectsTasks'

const machine = (changes: Partial<MachineTasks> = {}): MachineTasks => ({ machine: '', status: 'ready', version: '1.2.1', tasks: [], ...changes })

describe('Board coordinator entry points', () => {
  it('names the host and distinguishes all work, machine setup and repo work', () => {
    expect(coordinatorLabel({ kind: 'main' }, 'devbox')).toBe('Coordinator · devbox')
    expect(coordinatorLabel({ kind: 'machine' }, 'devbox')).toBe('devbox setup')
    expect(coordinatorLabel({ kind: 'project', repo: 'web' }, 'devbox')).toBe('web coordinator')
    expect(coordinatorDescription({ kind: 'main' })).toContain('every repo and machine')
    expect(coordinatorDescription({ kind: 'machine' })).toContain('setup, folders and repos')
    expect(coordinatorDescription({ kind: 'project', repo: 'web' })).toContain('this repo')
  })

  it('only enables a fresh, reachable, writable board', () => {
    expect(coordinatorUnavailable(machine())).toBe('')
    expect(coordinatorUnavailable(machine({ readOnly: true }))).toContain('container')
    expect(coordinatorUnavailable(machine({ status: 'error', error: 'SSH unavailable' }))).toBe('SSH unavailable')
    expect(coordinatorUnavailable(machine({ stale: true }))).toContain('cannot be reached')
    expect(coordinatorUnavailable(machine({ error: 'Read failed' }))).toBe('Read failed')
    expect(coordinatorUnavailable(machine(), true)).toContain('Offline')
    for (const status of ['missing', 'old', 'disabled', 'error'] as const) {
      expect(coordinatorUnavailable(machine({ status }))).not.toBe('')
    }
  })
})
