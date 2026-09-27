import { describe, expect, it } from 'vitest'
import { isProjectThread, shouldNotify } from '../server/utils/notificationPolicy'

const pane = (name: string | null, cwd: string | null) => ({ name, cwd })

describe('notifications de projet', () => {
  it('reconnaît le nom des threads et les worktrees sur les deux machines', () => {
    expect(isProjectThread(pane('hp-wherdr-t-0004-notifications-du-coordinateur-seulement', '/tmp'))).toBe(true)
    expect(isProjectThread(pane(null, '/home/user/.herdr/worktrees/herdr-web/hp-wherdr-t-0004-notifications/.herdr-project/wherdr-t-0004'))).toBe(true)
    expect(isProjectThread(pane(null, '/Users/alice/.herdr/worktrees/app/hp-app-t-0012'))).toBe(true)
    expect(isProjectThread(pane(null, '/Users/alice/.herdr/worktrees/app/renamed-thread/.herdr-project/app-t-0012'))).toBe(true)
    expect(isProjectThread(pane(null, '/Users/alice/.herdr-projects/app/threads/t-0012'))).toBe(true)
  })

  it('garde le coordinateur et les agents ordinaires', () => {
    expect(isProjectThread(pane('coordinator', '/home/user/.herdr-projects/wherdr'))).toBe(false)
    expect(isProjectThread(pane('codex', '/home/user/code/app'))).toBe(false)
    expect(isProjectThread(pane('codex', '/home/user/.herdr/worktrees/herdr-web/feature-x'))).toBe(false)
  })

  it('filtre par abonnement, avec le mode coordinateurs par défaut', () => {
    const thread = pane('hp-app-t-0001-task', null)
    const lead = pane('coordinator', '/Users/alice/.herdr-projects/app')
    expect(shouldNotify(undefined, thread)).toBe(false)
    expect(shouldNotify('project_leads', thread)).toBe(false)
    expect(shouldNotify('all', thread)).toBe(true)
    expect(shouldNotify(undefined, lead)).toBe(true)
    expect(shouldNotify('all', lead)).toBe(true)
  })
})
