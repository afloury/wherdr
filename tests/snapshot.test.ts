import { describe, expect, it } from 'vitest'
import { foregroundCommand, reduceSnapshot } from '../server/utils/snapshot'
import { selectSessions } from '../app/utils/sessionSelection'
import { tabLayout } from '../shared/layout'
import type { HerdrState } from '../shared/types'
import layouts from './fixtures/snapshot-layouts.json'

// Real snapshot (hwtest): 3 workspaces, 4 tabs; panes are added to it.
const pane = (id: string, tab: string, agent: string | null = null) => ({
  pane_id: id, workspace_id: tab.split(':')[0], tab_id: tab, agent, agent_status: agent ? 'idle' : 'unknown', cwd: '/home/user/app',
})
const snap = {
  version: '0.9.1',
  ...layouts,
  panes: [pane('w1:p1', 'w1:t1', 'claude'), pane('w1:p2', 'w1:t1', 'codex'), pane('w1:p3', 'w1:t1'), pane('w1:p4', 'w1:t2'), pane('w2:p1', 'w2:t1'), pane('w2:p2', 'w2:t1'), pane('w3:p1', 'w3:t1')],
}

describe('reduceSnapshot', () => {
  it('keeps the branch given by Herdr for a worktree', () => {
    const withBranch = { ...snap, workspaces: [{ ...snap.workspaces[0], worktree: { is_linked_worktree: true, branch: 'develop', repo_key: 'demo', repo_name: 'demo' } }] }
    expect(reduceSnapshot(withBranch).workspaces[0]).toMatchObject({ label: 'herdr-web', worktree: true, branch: 'develop' })
  })
  it('keeps the tabs and their layout', () => {
    const s = reduceSnapshot(snap)
    expect(s.session).toBe('default')
    expect(s.tabs!.map(t => [t.id, t.workspace, t.label, t.number])).toEqual([
      ['w1:t1', 'w1', 'dev', 1], ['w1:t2', 'w1', 'serveur', 2], ['w2:t1', 'w2', '1', 1], ['w3:t1', 'w3', '1', 1],
    ])
    const dev = s.tabs![0]!.layout!
    expect(dev.focused).toBe('w1:p1')
    expect(dev.panes.map(p => p.pane)).toEqual(['w1:p1', 'w1:p2', 'w1:p3'])
    expect(s.panes.find(p => p.id === 'w1:p4')!.tabLabel).toBe('serveur')
  })

  it('prefixes tabs, layouts and panes of a remote machine', () => {
    const s = reduceSnapshot(snap, 'abcd1234')
    expect(s.session).toBeUndefined()
    const t = s.tabs![0]!
    expect(t).toMatchObject({ id: 'abcd1234~w1:t1', machine: 'abcd1234', workspace: 'abcd1234~w1' })
    expect(t.layout!.tab).toBe('abcd1234~w1:t1')
    expect(t.layout!.focused).toBe('abcd1234~w1:p1')
    expect(t.layout!.panes.map(p => p.pane)).toEqual(['abcd1234~w1:p1', 'abcd1234~w1:p2', 'abcd1234~w1:p3'])
    expect(s.panes[0]!.tab).toBe('abcd1234~w1:t1')
  })

  it('tab without a layout: stacked panes', () => {
    const s = reduceSnapshot({ ...snap, layouts: [] })
    expect(s.tabs![0]!.layout).toBeNull()
    const l = tabLayout(s.tabs![0]!, ['w1:p1', 'w1:p2'])
    expect(l.panes.map(p => [p.pane, p.rect.y])).toEqual([['w1:p1', 0], ['w1:p2', 40]])
    expect(l.focused).toBe('w1:p1')
    expect(tabLayout(reduceSnapshot(snap).tabs![0]!, []).panes).toHaveLength(3)
  })

  it('snapshot sans onglets (ancien Herdr)', () => {
    const s = reduceSnapshot({ workspaces: [], panes: [] })
    expect(s.tabs).toEqual([])
  })
})

describe('displayed sessions', () => {
  it('only keeps the tabs of the chosen sessions', () => {
    const local = reduceSnapshot(snap)
    const other = reduceSnapshot(snap, 'abcd1234')
    const named = reduceSnapshot(snap, 'beef0001')
    const state: HerdrState = {
      ...local,
      workspaces: [...local.workspaces, ...other.workspaces, ...named.workspaces],
      tabs: [...local.tabs!, ...other.tabs!, ...named.tabs!],
      panes: [...local.panes, ...other.panes, ...named.panes],
      machines: [
        { key: '', label: 'host-a', local: true, status: 'online', error: null, session: 'default' },
        { key: 'abcd1234', label: 'laptop', local: false, status: 'online', error: null, session: 'default' },
        { key: 'beef0001', baseKey: 'abcd1234', label: 'laptop', local: false, status: 'online', error: null, session: 'wip' },
      ],
    }
    const tabs = selectSessions(state, { abcd1234: 'wip' }).tabs!.map(t => t.id)
    expect(tabs.filter(t => t.startsWith('beef0001~'))).toHaveLength(4)
    expect(tabs.filter(t => t.startsWith('abcd1234~'))).toHaveLength(0)
    expect(tabs.filter(t => !t.includes('~'))).toHaveLength(4)
  })
})

describe('foreground command of a pane', () => {
  const info = (procs: object[]) => ({ shell_pid: 10, foreground_processes: procs })
  it('gives the command launched from the shell', () => {
    expect(foregroundCommand(info([{ pid: 12, argv: ['/usr/local/bin/pnpm', 'dev'], name: 'pnpm' }]))).toBe('pnpm dev')
    expect(foregroundCommand(info([{ pid: 12, cmdline: 'npm run build', name: 'npm' }]))).toBe('npm run build')
  })
  it('reste vide au prompt du shell', () => {
    expect(foregroundCommand(info([{ pid: 10, argv: ['-bash'], name: 'bash' }]))).toBe('')
    expect(foregroundCommand(info([{ pid: 11, argv: ['zsh'], name: 'zsh' }]))).toBe('')
    expect(foregroundCommand(info([]))).toBe('')
    expect(foregroundCommand(null)).toBe('')
  })
})
