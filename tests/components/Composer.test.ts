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

  it('keeps paragraph spacing in the outgoing message', async () => {
    const { w, field } = await mount('w1:p3')
    const text = 'First paragraph.\n\nSecond paragraph.\n\n\nThird paragraph.'
    await field.setValue(text)
    await w.find('button.prompt-send').trigger('click')
    expect(outboxFor('w1:p3')).toMatchObject([{ text, state: 'sending' }])
    release()
    await flushPromises()
    await vi.waitFor(() => expect(outboxFor('w1:p3')).toHaveLength(0))
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

// References in the field (shared/reference.ts): the text is the only state.
describe('Composer references', () => {
  beforeEach(() => { eventsOpen.value = true })
  afterEach(() => { eventsOpen.value = false })
  const REF = '↳ Quote point 11:37 : Shall I merge the branch now? —'

  it('draws a reference line as a token behind the field, with a chip to remove it', async () => {
    const { w, field } = await mount('w2:p1')
    await field.setValue(`${REF}\nYes\n> typed by hand`)
    await flushPromises()
    expect(w.findAll('.qm-mirror .qm-q').map(q => q.text())).toEqual([REF])
    expect(w.findAll('.composer-quote').map(q => q.text())).toEqual(['Shall I merge the branch now?'])
    await w.find('.composer-quote-x').trigger('click')
    expect((field.element as HTMLTextAreaElement).value).toBe('Yes\n> typed by hand')
    await flushPromises()
    // Nothing left to draw: the plain field, and a ">" line starts nothing.
    expect(w.find('.qm-mirror').exists()).toBe(false)
    expect(w.findAll('.composer-quote')).toHaveLength(0)
    w.unmount()
  })

  it('sends the text of the field as it is, references included', async () => {
    const { w, field } = await mount('w2:p2')
    await field.setValue(`${REF}\nYes`)
    await w.find('button.prompt-send').trigger('click')
    expect(outboxFor('w2:p2')).toMatchObject([{ text: `${REF}\nYes` }])
    release()
    await flushPromises()
    w.unmount()
  })

  it('keeps a pasted line that reads as a reference plain text', async () => {
    const { w, field } = await mount('w2:p3')
    await field.setValue('')
    const el = field.element as HTMLTextAreaElement
    const paste = (text: string) => {
      const e = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown }
      e.clipboardData = { items: [], getData: () => text }
      el.dispatchEvent(e)
      return e.defaultPrevented
    }
    // An ordinary paste is left to the browser.
    expect(paste('plain words')).toBe(false)
    expect(paste(`From the log:\n${REF}\nGo ahead.`)).toBe(true)
    await flushPromises()
    expect(el.value).toBe(`From the log:\n ${REF}\nGo ahead.`)
    expect(w.find('.qm-mirror').exists()).toBe(false)
    expect(w.findAll('.composer-quote')).toHaveLength(0)
    w.unmount()
  })
})

