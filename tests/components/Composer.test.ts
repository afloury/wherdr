import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import Composer from '~/components/Composer.vue'
import { eventsOpen } from '~/composables/useHerdr'
import { outboxFor } from '~/composables/useOutbox'
import type { Pane } from '#shared/types'

// An agent kind without a model picker: the test stays on the field and the send button.
const pane = (id: string, status: Pane['status'] = 'idle'): Pane => ({
  id, workspace: 'w1', tab: 'w1:t1', tabLabel: null, agent: 'pi', name: null, label: null, status, title: null, cwd: '/home/user/demo', agentSession: null,
})

let release: () => void = () => {}
registerEndpoint('/api/prompt', {
  method: 'POST',
  handler: () => {
    const { promise, resolve } = Promise.withResolvers<{ ok: boolean }>()
    release = () => resolve({ ok: true })
    return promise
  },
})

async function mount(id: string) {
  const w = await mountSuspended(Composer, { props: { pane: pane(id), paneId: id, sendKeys: async () => {} } })
  const field = w.find('textarea')
  await field.setValue('Fix the cache')
  return { w, field }
}

describe('Composer send', () => {
  beforeEach(() => { eventsOpen.value = true })
  afterEach(() => { eventsOpen.value = false })

  it('empties the field and shows the message as sending before the server answers', async () => {
    const { w, field } = await mount('w1:p1')
    await w.find('button.prompt-send').trigger('click')
    expect((field.element as HTMLTextAreaElement).value).toBe('')
    expect(outboxFor('w1:p1')).toMatchObject([{ text: 'Fix the cache', state: 'sending' }])
    release()
    await flushPromises()
    await vi.waitFor(() => expect(outboxFor('w1:p1')).toHaveLength(0))
    w.unmount()
  })

  it('offline: keeps the draft and sends nothing', async () => {
    eventsOpen.value = false
    const { w, field } = await mount('w1:p2')
    expect(w.find('button.prompt-send').attributes('disabled')).toBeDefined()
    await w.find('textarea').trigger('keydown', { key: 'Enter' })
    expect((field.element as HTMLTextAreaElement).value).toBe('Fix the cache')
    expect(outboxFor('w1:p2')).toHaveLength(0)
    w.unmount()
  })
})
