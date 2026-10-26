import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import RepoArchiveMenu from '~/components/RepoArchiveMenu.vue'
import MenuSheet from '~/components/MenuSheet.vue'
import { answerConfirm, commandResult, confirmState, menuState, toDropdown } from '~/composables/useUi'
import { cachedAt } from '~/composables/useHerdr'
import type { TaskRow } from '#shared/projectsTasks'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
mockNuxtImport('api', () => request)
const tasks = ['done', 'working', 'todo'].map((group, n) => ({ id: `demo/${n + 1}`, repo: 'demo', group, stage: group, title: group })) as TaskRow[]
const mount = (over = {}) => mountSuspended(RepoArchiveMenu, {
  props: { machine: 'remote', repo: 'demo', machineLabel: 'Build box', tasks, ...over },
  global: { stubs: { SpaceMenu: { props: ['items'], template: '<button :disabled="items()[0].disabled" @click="items()[0].run()">Archive</button>' } } },
})

describe('repository archive menu', () => {
  afterEach(() => { answerConfirm(false); cachedAt.value = null; commandResult.open = false; request.mockReset() })
  it('confirms the repo, owner and known done count; cancellation writes nothing', async () => {
    const w = await mount()
    await w.find('button').trigger('click')
    expect(confirmState.message).toContain('demo on Build box')
    expect(confirmState.message).toContain('Completed tasks currently known: 1')
    expect(request).not.toHaveBeenCalled()
    expect(w.find('button').attributes('disabled')).toBeDefined()
    answerConfirm(false)
    await vi.waitFor(() => expect(w.find('button').attributes('disabled')).toBeUndefined())
    expect(request).not.toHaveBeenCalled()
    expect(w.emitted('refresh')).toBeUndefined()
    w.unmount()
  })
  it('writes once after confirmation, displays the pinned exception and refreshes', async () => {
    let finish!: (r: unknown) => void
    request.mockImplementation(() => new Promise(r => { finish = r }))
    const w = await mount()
    await w.find('button').trigger('click')
    answerConfirm(true)
    await vi.waitFor(() => expect(request).toHaveBeenCalledExactlyOnceWith('/api/tasks/archive-done', { machine: 'remote', repo: 'demo' }))
    expect(w.find('button').attributes('disabled')).toBeDefined()
    finish({ code: 0, stdout: 'Archived 0 tasks. Kept 1 pinned task.', stderr: 'CLI notice' })
    await vi.waitFor(() => expect(w.emitted('refresh')).toHaveLength(1))
    expect(commandResult.text).toContain('Kept 1 pinned task.')
    expect(commandResult.text).toContain('CLI notice')
    expect(tasks.map(t => t.group)).toEqual(['done', 'working', 'todo'])
    w.unmount()
  })
  for (const response of ['cli', 'network']) it(`shows ${response} errors and refreshes`, async () => {
    if (response === 'cli') request.mockResolvedValue({ code: 1, stdout: 'Partial result', stderr: 'Cannot archive\nDetails' })
    else request.mockRejectedValue(new Error('Connection lost'))
    const w = await mount()
    await w.find('button').trigger('click')
    answerConfirm(true)
    await vi.waitFor(() => expect(w.emitted('refresh')).toHaveLength(1))
    expect(commandResult.text).toContain(response === 'cli' ? 'Cannot archive\nDetails\nExit code: 1' : 'Connection lost')
    w.unmount()
  })
  it('disables with no done tasks, an unavailable owner or offline, and rechecks after confirmation', async () => {
    for (const props of [{ tasks: tasks.slice(1) }, { disabled: true }]) {
      const w = await mount(props)
      expect(w.find('button').attributes('disabled')).toBeDefined()
      w.unmount()
    }
    const w = await mount()
    await w.find('button').trigger('click')
    cachedAt.value = Date.now()
    answerConfirm(true)
    await vi.waitFor(() => expect(w.find('button').attributes('disabled')).toBeDefined())
    expect(request).not.toHaveBeenCalled()
    w.unmount()
  })
})


it('keeps disabled entries inert in both desktop dropdowns and mobile sheets', async () => {
  const run = vi.fn()
  const item = { label: 'Archive completed tasks', disabled: true, run }
  const dropdown = toDropdown([item])[0]![0]!
  expect(dropdown.disabled).toBe(true)
  dropdown.onSelect()
  expect(run).not.toHaveBeenCalled()
  menuState.items = [item]
  menuState.open = true
  const w = await mountSuspended(MenuSheet, { global: { stubs: { AppSheet: { template: '<div><slot /></div>' } } } })
  expect(w.find('button').attributes('disabled')).toBeDefined()
  await w.find('button').trigger('click')
  expect(run).not.toHaveBeenCalled()
  menuState.open = false
  w.unmount()
})
