import { describe, expect, it } from 'vitest'
import { parseSessionList, sessionKey } from '../shared/sessions'
import { readSessionSelection, selectSessions, writeSessionSelection } from '../app/utils/sessionSelection'
import type { HerdrState } from '../shared/types'

const raw = JSON.stringify({ sessions: [
  { name: 'default', running: true, socket_path: '/home/x/.config/herdr/herdr.sock' },
  { name: 'hwtest', running: true, socket_path: '/home/x/.config/herdr/sessions/hwtest/herdr.sock' },
  { name: 'archive', running: false },
] })

describe('named sessions', () => {
  it('reads the states and reserves the historical key for the current session', () => {
    expect(parseSessionList(raw, '', 'default')).toEqual([
      { name: 'default', running: true, key: '' },
      { name: 'archive', running: false, key: sessionKey('', 'archive') },
      { name: 'hwtest', running: true, key: sessionKey('', 'hwtest') },
    ])
    expect(parseSessionList(raw, '0a1b2c3d', 'hwtest')[0]).toEqual({ name: 'hwtest', running: true, key: '0a1b2c3d' })
    expect(parseSessionList('{', '', 'default')).toEqual([])
  })

  it('isolates each device\'s choice and falls back to the default if the session disappears', () => {
    const alt = sessionKey('', 'hwtest')
    const state: HerdrState = {
      ok: true, workspaces: [
        { id: 'w1', label: 'défaut', number: 1, status: null, worktree: false },
        { id: `${alt}~w1`, machine: alt, label: 'test', number: 1, status: null, worktree: false },
      ],
      panes: [
        { id: 'w1:p1', workspace: 'w1', tab: 'w1:t1', tabLabel: null, agent: null, name: null, label: null, status: null, title: null, cwd: null, agentSession: null },
        { id: `${alt}~w1:p1`, machine: alt, workspace: `${alt}~w1`, tab: `${alt}~w1:t1`, tabLabel: null, agent: null, name: null, label: null, status: null, title: null, cwd: null, agentSession: null },
      ],
      machines: [
        { key: '', label: 'Server', local: true, session: 'default', status: 'online', error: null },
        { key: alt, baseKey: '', session: 'hwtest', label: 'Server', local: true, status: 'online', error: null },
      ],
    }
    expect(selectSessions(state, {}).panes.map(p => p.id)).toEqual(['w1:p1'])
    expect(selectSessions(state, { '': 'hwtest' }).panes.map(p => p.id)).toEqual([`${alt}~w1:p1`])
    const gone = { ...state, machines: state.machines!.slice(0, 1) }
    expect(selectSessions(gone, { '': 'hwtest' }).panes.map(p => p.id)).toEqual(['w1:p1'])
    expect(selectSessions(state, { '': 'hwtest' }).session).toBe('hwtest')
  })

  it('remembers the choice per machine on the device and ignores invalid values', () => {
    const names = { '': 'hwtest', '0a1b2c3d': 'work' }
    expect(readSessionSelection(writeSessionSelection(names))).toEqual(names)
    expect(readSessionSelection('{')).toEqual({})
    expect(readSessionSelection('{"../x":"danger","":"hwtest"}')).toEqual({ '': 'hwtest' })
  })
})
