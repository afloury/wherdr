import { describe, expect, it } from 'vitest'
import type { HerdrState } from '../shared/types'
import type { MachineLinks } from '../shared/boardLinks'
import { conversationIn, machineConversation, readConversationMemory } from '../app/utils/machineConversation'

const s = {
  ok: true,
  machines: [{ key: '', status: 'online' }, { key: 'remote', status: 'online' }, { key: 'remote/review', baseKey: 'remote', status: 'online' }, { key: 'away', status: 'offline' }],
  workspaces: [{ id: 'local', machine: '' }, { id: 'remote', machine: 'remote' }, { id: 'review', machine: 'remote/review' }],
  panes: [{ id: 'local-agent', workspace: 'local' }, { id: 'remote-agent', workspace: 'remote' }, { id: 'coord', workspace: 'remote' }, { id: 'review-agent', workspace: 'review', tab: 'review-tab' }],
  tabs: [{ id: 'review-tab', workspace: 'review' }],
} as HerdrState
const groups = [{ id: '*group:work', name: 'Work', machines: ['away', 'remote', ''] }, { id: '*group:empty', name: 'Empty', machines: [] }]
const links = [{ machine: 'remote', coordinators: [{ level: 'machine', pane: 'coord' }], tasks: [] }] as unknown as MachineLinks[]
const local = { pane: 'local-agent' }
const remote = { pane: 'remote-agent' }
const choose = (pick: string, memory = {}, current = local) => machineConversation(s, pick, groups, memory, current, links)

describe('conversation selection on the machine bar', () => {
  it('keeps All and a conversation that belongs to the new selection', () => {
    expect(choose('*')).toBeUndefined()
    expect(choose('')).toBeUndefined()
    expect(choose('*group:work')).toBeUndefined()
    expect(choose('remote', { remote: { pane: 'coord' } }, remote)).toBeUndefined()
  })
  it('restores independent device histories for machines and groups', () => {
    const memory = readConversationMemory(JSON.stringify({ remote, '*group:work': { tab: 'review-tab' }, '': local }))
    expect(choose('remote', memory)).toEqual(remote)
    expect(choose('*group:work', memory, { pane: 'missing' })).toEqual({ tab: 'review-tab' })
    expect(choose('', memory, remote)).toEqual(local)
  })
  it('falls back to the machine coordinator for missing, deleted or moved history', () => {
    expect(choose('remote')).toEqual({ pane: 'coord' })
    expect(choose('remote', { remote: { pane: 'deleted' } })).toEqual({ pane: 'coord' })
    expect(choose('remote', { remote: local })).toEqual({ pane: 'coord' })
  })
  it('uses the first online machine in group order and otherwise the empty state', () => {
    expect(choose('*group:work', {}, { pane: 'missing' })).toEqual({ pane: 'coord' })
    expect(choose('*group:empty')).toBeNull()
    expect(choose('away')).toBeNull()
    const firstLocal = [{ ...groups[0]!, machines: ['', 'remote'] }]
    expect(machineConversation(s, '*group:work', firstLocal, {}, null, links)).toBeNull()
  })
  it('includes named sessions by the workspace base machine, including tab plans', () => {
    expect(conversationIn(s, { pane: 'review-agent' }, 'remote', groups)).toBe(true)
    expect(conversationIn(s, { tab: 'review-tab' }, 'remote', groups)).toBe(true)
    expect(conversationIn(s, { pane: 'local-agent' }, 'remote', groups)).toBe(false)
  })
  it('ignores broken storage and invalid entries', () => {
    for (const raw of ['null', '[]', 'broken', '42']) expect(readConversationMemory(raw)).toEqual({})
    expect(readConversationMemory('{"remote":{"pane":"remote-agent"},"bad":7}')).toEqual({ remote })
  })
})
