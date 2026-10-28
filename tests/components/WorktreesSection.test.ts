import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import WorktreesSection from '~/components/WorktreesSection.vue'
import { worktrees } from '~/composables/useWorktrees'
import { herdrState } from '~/composables/useHerdr'
import type { WorktreeInfo } from '#shared/types'

const { load, remove } = vi.hoisted(() => ({ load: vi.fn(), remove: vi.fn() }))
mockNuxtImport('loadWorktrees', () => load)
mockNuxtImport('removeWorktreeFlow', () => remove)
const tree = (machine: string, repoRoot: string, branch: string): WorktreeInfo => ({
  machine, repoRoot, repo: repoRoot.split('/').pop()!, branch, path: `/worktrees/${branch}`,
  workspace: null, agents: 0, panes: 0, prunable: false,
})
let wrapper: Awaited<ReturnType<typeof mountSuspended>> | undefined
beforeEach(() => {
  herdrState.value = { ok: true, workspaces: [], panes: [], machines: [
    { key: '', label: 'Server', local: true, status: 'online', error: null, session: 'default' },
    { key: 'remote', label: 'Remote', local: false, status: 'online', error: null, session: 'default' },
    { key: 'empty', label: 'Empty', local: false, status: 'online', error: null, session: 'default' },
  ] }
  worktrees.value = [tree('', '/repos/demo', 'first'), tree('', '/repos/demo', 'second'),
    tree('', '/other/demo', 'other'), tree('remote', '/repos/demo', 'remote-branch')]
  vi.clearAllMocks()
})
afterEach(() => { wrapper?.unmount(); worktrees.value = null; herdrState.value = { ok: false, workspaces: [], panes: [] } })
it('switches machines with click and keyboard, and excludes machines without worktrees', async () => {
  wrapper = await mountSuspended(WorktreesSection)
  const tabs = wrapper.findAll('[role="tab"]')
  expect(tabs.map(t => t.text())).toEqual(['Server', 'Remote'])
  expect(wrapper.findAll('.wt-list li')).toHaveLength(3)
  await tabs[1]!.trigger('click')
  expect(tabs[1]!.attributes('aria-selected')).toBe('true')
  expect(wrapper.findAll('.wt-list li').map(w => w.text()).join()).toContain('remote-branch')
  expect(wrapper.findAll('.wt-list li')).toHaveLength(1)
  await tabs[1]!.trigger('keydown', { key: 'Home' })
  expect(tabs[0]!.attributes('aria-selected')).toBe('true')
  worktrees.value = worktrees.value!.filter(w => w.machine === 'remote')
  await vi.waitFor(() => expect(wrapper!.findAll('[role="tab"]')).toHaveLength(1))
  expect(wrapper.find('[role="tab"]').attributes('aria-selected')).toBe('true')
})
it('groups by repository root, toggles projects independently, and retains their state across tabs', async () => {
  wrapper = await mountSuspended(WorktreesSection)
  const headings = wrapper.findAll('.wt-project-heading')
  expect(headings.map(h => h.text())).toEqual(['demo2', 'demo1'])
  await headings[0]!.trigger('click')
  expect(headings[0]!.attributes('aria-expanded')).toBe('false')
  expect((wrapper.findAll('.wt-list')[0]!.element as HTMLElement).style.display).toBe('none')
  expect((wrapper.findAll('.wt-list')[1]!.element as HTMLElement).style.display).not.toBe('none')
  await wrapper.findAll('[role="tab"]')[1]!.trigger('click')
  expect(wrapper.find('.wt-project-heading').attributes('aria-expanded')).toBe('true')
  await wrapper.findAll('[role="tab"]')[0]!.trigger('click')
  expect((wrapper.find('.wt-list').element as HTMLElement).style.display).toBe('none')
  await wrapper.find('.wt-project-heading').trigger('click')
  expect((wrapper.find('.wt-list').element as HTMLElement).style.display).not.toBe('none')
  await wrapper.find('.wt-del').trigger('click')
  expect(remove).toHaveBeenCalledWith(worktrees.value![0])
})
it('keeps loading and empty states', async () => {
  worktrees.value = null
  wrapper = await mountSuspended(WorktreesSection)
  expect(wrapper.find('.spinner').exists()).toBe(true)
  worktrees.value = []
  await vi.waitFor(() => expect(wrapper!.text()).toContain('No worktrees.'))
  expect(wrapper.find('[role="tablist"]').exists()).toBe(false)
})
