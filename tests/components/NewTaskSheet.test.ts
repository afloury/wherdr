import { describe, expect, it, vi } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { readBody } from 'h3'
import { flushPromises } from '@vue/test-utils'
import NewTaskSheet from '~/components/NewTaskSheet.vue'

const calls: unknown[] = []
registerEndpoint('/api/tasks/add', { method: 'POST', handler: async event => {
  calls.push(await readBody(event))
  return { msg: 'Added' }
} })
const sheet = () => mountSuspended(NewTaskSheet, {
  props: { open: true, machines: ['', 'remote'], repos: { remote: ['demo'] }, machine: 'remote', repo: 'demo' },
  global: { stubs: { AppSheet: { template: '<div><slot /><slot name="footer" /></div>' } } },
})

describe('new task type', () => {
  it('defaults to Work on every opening and selects exactly one type', async () => {
    const w = await sheet()
    expect(w.find('[data-task-type="work"]').attributes('aria-pressed')).toBe('true')
    for (const type of ['research', 'chat', 'work']) {
      await w.find('[data-task-type="' + type + '"]').trigger('click')
      expect(w.findAll('[data-task-type][aria-pressed="true"]')).toHaveLength(1)
      expect(w.find('[data-task-type="' + type + '"]').attributes('aria-pressed')).toBe('true')
    }
    await w.find('[data-task-type="chat"]').trigger('click')
    await w.setProps({ open: false })
    await w.setProps({ open: true })
    expect(w.find('[data-task-type="work"]').attributes('aria-pressed')).toBe('true')
    w.unmount()
  })
  it.each(['work', 'research', 'chat'])('sends %s and preserves machine, repo and delegation', async type => {
    for (const delegate of [false, true]) {
      calls.length = 0
      const w = await sheet()
      await w.find('#new-task-title').setValue('Compare options')
      await w.find('[data-task-type="' + type + '"]').trigger('click')
      if (delegate) await w.find('[role="switch"]').trigger('click')
      await w.find('form').trigger('submit')
      await flushPromises()
      expect(calls).toEqual([{ machine: 'remote', repo: 'demo', title: 'Compare options', description: '', type, delegate }])
      await vi.waitFor(() => expect(w.emitted('added')).toEqual([['remote']]))
      w.unmount()
    }
  })
})
