import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import TaskKey from '~/components/TaskKey.vue'
import TaskCard from '~/components/TaskCard.vue'
import { parseTaskRow } from '#shared/projectsTasks'

const clip = (writeText: (s: string) => Promise<void>) =>
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

describe('TaskKey', () => {
  afterEach(() => { vi.useRealTimers() })

  it('copies the key on a click and says so for a second', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn(() => Promise.resolve())
    clip(writeText)
    const w = await mountSuspended(TaskKey, { props: { value: 'PRP-28' } })
    const b = w.find('button.task-key')
    expect(b.attributes('aria-label')).toBe('Copy ID PRP-28')
    await b.trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith('PRP-28')
    expect(w.find('.task-key-flash').text()).toBe('Copied')
    vi.advanceTimersByTime(1000)
    await flushPromises()
    expect(w.find('.task-key-flash').exists()).toBe(false)
    expect(b.text()).toBe('PRP-28')
  })

  it('says the copy failed when the clipboard is refused, without throwing', async () => {
    clip(() => Promise.reject(new DOMException('denied', 'NotAllowedError')))
    const w = await mountSuspended(TaskKey, { props: { value: 'PRP-28' } })
    await w.find('button.task-key').trigger('click')
    await flushPromises()
    expect(w.find('button.task-key').classes()).toContain('fail')
    expect(w.find('.task-key-flash').text()).toBe('Copy failed')
  })

  it('on a board card, copies the key without opening the task', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    clip(writeText)
    const task = parseTaskRow({ id: 'demo/9', title: 'Improve search', stage: 'asks', state: 'blocked', kind: 'question', app: 'claude' })!
    const w = await mountSuspended(TaskCard, { props: { task } })
    const key = w.find('button.task-key')
    await key.trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith(key.find('.task-key-text').text())
    expect(w.emitted('open')).toBeUndefined()
  })
})
