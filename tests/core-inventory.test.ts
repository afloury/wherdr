import { expect, it } from 'vitest'
import { coreActivity, coreTitle } from '../shared/coreInventory'
const terminal = { address: 'host-a/t7', cwd: '/workspace/demo', state: 'live' }
it('keeps missing and unrecognized status unknown, independently of process state', () => {
  expect(coreActivity(terminal)).toBe('unknown')
  expect(coreActivity({ ...terminal, state: 'finished' })).toBe('unknown')
  expect(coreActivity({ ...terminal, status: { state: 'future' } })).toBe('unknown')
  expect(coreActivity({ ...terminal, status: { state: 'idle' } })).toBe('idle')
  expect(coreActivity({ ...terminal, status: { state: 'blocked' } })).toBe('blocked')
})
it('uses qualified addresses as fallback identity without inferring an agent brand', () => {
  expect(coreTitle(terminal)).toBe('host-a/t7')
  expect(coreTitle({ ...terminal, name: 'review', title: 'Other title' })).toBe('review')
})
