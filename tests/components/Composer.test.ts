import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { defineComponent, h, nextTick, ref } from 'vue'
import { UApp } from '#components'
import Composer from '~/components/Composer.vue'
import { desk, eventsOpen } from '~/composables/useHerdr'
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

  it('shows the quota card and its actions only while the parent displays conversation', async () => {
    const p = { ...pane('w3:p9'), usageLimit: { resets: '11pm', automatic: true, credits: true, resetLink: true } }
    const w = await mountSuspended(Composer, { props: { pane: p, paneId: p.id, sendKeys: async () => {} } })
    expect(w.find('.usage-limit-card').exists()).toBe(false)
    await w.setProps({ conversation: true })
    expect(w.find('.usage-limit-card').exists()).toBe(true)
    expect(w.findAll('.usage-limit-card button, .usage-limit-card a')).toHaveLength(3)
    await w.setProps({ conversation: false })
    expect(w.find('.usage-limit-card').exists()).toBe(false)
    expect(w.findAll('.usage-limit-card button, .usage-limit-card a')).toHaveLength(0)
    w.unmount()
  })

  it('shows text left in Codex’s field and clears it with Ctrl+U / Backspace', async () => {
    const keys: string[][] = []
    const p = ref<Pane>({ ...pane('w3:p8'), agent: 'codex', codexField: '[<65;76;23M' })
    const Host = defineComponent({ render: () => h(UApp, null, () => h(Composer, { pane: p.value, paneId: p.value.id, sendKeys: async (k: string[]) => { keys.push(k) } })) })
    const w = await mountSuspended(Host)
    const notice = w.find('.codex-field')
    expect(notice.find('code').text()).toBe('[<65;76;23M')
    await notice.find('button').trigger('click')
    await flushPromises()
    expect(keys).toHaveLength(1)
    expect(new Set(keys[0])).toEqual(new Set(['ctrl+u', 'backspace']))
    p.value = { ...p.value, codexField: undefined }
    await nextTick()
    expect(w.find('.codex-field').exists()).toBe(false)
    w.unmount()
  })

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
    expect(el.value).toBe(`From the log:\n\\${REF}\nGo ahead.`)
    expect(w.find('.qm-mirror').exists()).toBe(false)
    expect(w.findAll('.composer-quote')).toHaveLength(0)
    w.unmount()
  })
})


// Claude Code's grayed-out suggestion: Tab on a computer, a "Use" button in the field on a phone.
describe('Composer suggestion', () => {
  // Earlier mounts may leave the wide-screen layout on: start each test on a phone.
  beforeEach(() => { eventsOpen.value = true; desk.value = false })
  afterEach(() => { eventsOpen.value = false; desk.value = false })
  const SUGGESTION = 'yes add the teardown and check both'
  const suggesting = (id: string): Pane => ({ ...pane(id), claudeSuggestion: SUGGESTION })
  const mountSuggesting = (id: string, unanswered?: number) =>
    mountSuspended(Composer, { props: { pane: suggesting(id), paneId: id, sendKeys: async () => {}, unanswered } })

  it('phone: the button fills the field with the suggestion without sending it', async () => {
    const w = await mountSuggesting('w4:p1')
    const field = w.find('textarea')
    expect(field.attributes('placeholder')).toBe(SUGGESTION)
    const use = w.find('button.prompt-suggest')
    expect(use.exists()).toBe(true)
    expect(use.attributes('aria-label')).toBe('Use suggestion')
    await use.trigger('click')
    expect((field.element as HTMLTextAreaElement).value).toBe(SUGGESTION)
    expect(outboxFor('w4:p1')).toHaveLength(0)
    // Text in the field: no suggestion, no button.
    expect(w.find('button.prompt-suggest').exists()).toBe(false)
    // Still editable.
    await field.setValue(`${SUGGESTION}, then merge`)
    expect((field.element as HTMLTextAreaElement).value).toBe(`${SUGGESTION}, then merge`)
    w.unmount()
  })

  it('phone: the button and the unanswered questions tab show together', async () => {
    const w = await mountSuggesting('w4:p2', 2)
    expect(w.find('.composer-ask').text()).toContain('2 questions unanswered')
    // In the field, not above it where the tab hangs.
    expect(w.find('.prompt button.prompt-suggest').exists()).toBe(true)
    expect(w.find('.prompt').classes()).toContain('suggesting')
    w.unmount()
  })

  it('no suggestion: no button', async () => {
    const w = await mountSuspended(Composer, { props: { pane: pane('w4:p3'), paneId: 'w4:p3', sendKeys: async () => {}, unanswered: 1 } })
    expect(w.find('button.prompt-suggest').exists()).toBe(false)
    expect(w.find('.prompt').classes()).not.toContain('suggesting')
    w.unmount()
  })

  it('computer: no button, Tab takes the suggestion', async () => {
    desk.value = true
    const w = await mountSuggesting('w4:p4')
    expect(w.find('button.prompt-suggest').exists()).toBe(false)
    const field = w.find('textarea')
    await field.trigger('keydown', { key: 'Tab' })
    expect((field.element as HTMLTextAreaElement).value).toBe(SUGGESTION)
    expect(outboxFor('w4:p4')).toHaveLength(0)
    w.unmount()
  })
})
