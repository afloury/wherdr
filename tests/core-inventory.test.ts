import { expect, it } from 'vitest'
import { coreActivity, coreTitle, ownTitle } from '../shared/coreInventory'
const terminal = { address: 'host-a/t7', cwd: '/workspace/demo', state: 'live' }
it('keeps missing and unrecognized status unknown, independently of process state', () => {
  expect(coreActivity(terminal)).toBe('unknown')
  expect(coreActivity({ ...terminal, state: 'finished' })).toBe('unknown')
  expect(coreActivity({ ...terminal, status: { state: 'future' } })).toBe('unknown')
  expect(coreActivity({ ...terminal, status: { state: 'idle' } })).toBe('idle')
  expect(coreActivity({ ...terminal, status: { state: 'blocked' } })).toBe('blocked')
})
it('falls back to the folder, then the address, without inferring an agent brand', () => {
  expect(coreTitle(terminal)).toBe('demo')
  expect(coreTitle({ ...terminal, cwd: '/' })).toBe('host-a/t7')
  expect(coreTitle({ ...terminal, name: 't7' })).toBe('demo')
  expect(coreTitle({ ...terminal, name: 'review', title: 'Other title' })).toBe('review')
})
it('ignores a name that only repeats the address', () => {
  expect(ownTitle({ ...terminal, name: 't7' })).toBeNull()
  expect(ownTitle({ ...terminal, name: 'host-a/t7' })).toBeNull()
  expect(ownTitle({ ...terminal, name: 'review' })).toBe('review')
  expect(ownTitle({ ...terminal, name: 't7', labels: { 'herdr.title': 'Parser' } })).toBe('Parser')
})
