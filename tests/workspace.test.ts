import { describe, expect, it } from 'vitest'
import type { Project } from '../shared/pm/project'
import { cleanWorkspaceFields, effectiveProject, effectiveWorkflow, memberOverrides, workspaceErrors, workspaceTaskError } from '../shared/pm/workspace'
import { defaultWorkflow } from '../shared/pm/workflow'

const ws: Project = {
  key: 'WS', name: 'Work', machine: 'home', path: '~/work', git: false, kind: 'workspace', group: 'g1', addedAt: 1,
  shared: {
    machines: ['big'], clones: { big: '/srv/work' }, paused: ['big'], placement: 'balance', base: 'develop', branchName: 'ws/{id}',
    prefs: { agent: 'codex', model: 'gpt-5', reviewFallbackAgent: 'claude', reviewFallbackModel: 'opus' }, worktree: { share: ['node_modules'] }, archiveAfter: 30, deleteBranch: false,
  },
}
const member: Project = { key: 'PAY', name: 'payroll-api', machine: 'home', path: '~/work/payroll-api', workspace: 'WS', addedAt: 2 }

describe('workspaces', () => {
  it('a member inherits every shared field, its clone under each machine\'s root', () => {
    expect(effectiveProject(member, ws)).toEqual({
      ...member, machines: ['home', 'big'], clones: { big: '/srv/work/payroll-api' }, paused: ['big'],
      placement: 'balance', base: 'develop', branchName: 'ws/{id}', archiveAfter: 30, deleteBranch: false,
    })
    expect(effectiveWorkflow(defaultWorkflow('PAY'), member, ws)).toMatchObject({ prefs: ws.shared!.prefs, worktree: ws.shared!.worktree })
    // Not a member: as is.
    expect(effectiveProject({ ...member, workspace: undefined }, ws)).toEqual({ ...member, workspace: undefined })
  })

  it('an override wins, and clearing it falls back to the shared value', () => {
    const own: Project = { ...member, base: 'main', machines: ['home'], placement: 'home', overrides: ['base', 'machines', 'placement', 'prefs'] }
    const e = effectiveProject(own, ws)
    expect(e).toMatchObject({ base: 'main', machines: ['home'], placement: 'home', branchName: 'ws/{id}' })
    expect(e.clones).toBeUndefined()
    expect(effectiveWorkflow(defaultWorkflow('PAY'), own, ws).prefs).toEqual(defaultWorkflow('PAY').prefs)
    // A base of '' clears the override.
    const cleared = { ...own, base: undefined, ...memberOverrides(own, { base: '' }) }
    expect(cleared.overrides).toEqual(['machines', 'placement', 'prefs'])
    expect(effectiveProject(cleared, ws).base).toBe('develop')
    expect(memberOverrides(member, { archiveAfter: 0 })).toEqual({ overrides: ['archiveAfter'] })
  })

  it('a workspace refuses a normal task, a project takes it', () => {
    expect(workspaceTaskError(ws, 'task')).toMatch(/features only/)
    expect(workspaceTaskError(ws, 'feature')).toBe('')
    expect(workspaceTaskError(member, 'task')).toBe('')
  })

  it('refuses a workspace with git, an unknown workspace, a nested one and an unknown override', () => {
    expect(workspaceErrors([ws, member])).toEqual([])
    expect(workspaceErrors([{ ...ws, git: undefined }])).toEqual(['Workspace WS is a folder without git'])
    expect(workspaceErrors([member])).toEqual(['PAY names no existing workspace'])
    expect(workspaceErrors([ws, { ...member, workspace: 'PAY' }, { ...member, key: 'X', workspace: 'WS' }])).toEqual(['PAY names no existing workspace'])
    expect(workspaceErrors([ws, { ...ws, key: 'W2', workspace: 'WS' }])).toEqual(['Workspace W2 cannot be in a workspace'])
    expect(workspaceErrors([ws, { ...member, overrides: ['name' as never] }])).toEqual(['PAY overrides an unknown field'])
    expect(cleanWorkspaceFields({ kind: 'workspace', shared: { base: 'a..b', prefs: { agent: 3 } } }).errors.map(e => e.path)).toEqual(['shared.base', 'shared.prefs.agent'])
  })
})
