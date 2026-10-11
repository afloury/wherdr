import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import Composer from '~/components/Composer.vue'
import { eventsOpen } from '~/composables/useHerdr'
import { useDraft } from '~/composables/useDraft'
import { outboxFor } from '~/composables/useOutbox'
import { refsIn } from '#shared/reference'
import type { Pane } from '#shared/types'

let release: () => void = () => {}
registerEndpoint('/api/prompt', { method: 'POST', handler: () => new Promise(resolve => { release = () => resolve({ ok: true }) }) })
const REF = '↳ Quote point 11:37 : Shall I publish? —'
async function mount(id: string) {
  const pane: Pane = { id, workspace: 'w1', tab: 'w1:t1', tabLabel: null, agent: 'pi', name: null, label: null, status: 'idle', title: null, cwd: '/tmp/demo', agentSession: null }
  const w = await mountSuspended(Composer, { props: { pane, paneId: id, sendKeys: async () => {} } })
  return { w, field: w.find('textarea') }
}
function paste(el: Element, text: string) {
  const e = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown }
  e.clipboardData = { items: [], getData: () => text }
  el.dispatchEvent(e)
}

describe('references and pasted text in the message field', () => {
  beforeEach(() => { eventsOpen.value = true })
  afterEach(() => { release(); eventsOpen.value = false })

  it('does not turn the first pasted line into a reference on send', async () => {
    const id = 'ref-paste-first'
    const { w, field } = await mount(id)
    try {
      paste(field.element, `${REF}\nNo`)
      await flushPromises()
      expect(w.findAll('.composer-quote')).toHaveLength(0)
      await w.find('button.prompt-send').trigger('click')
      // The message is trimmed on its way out: the escape is still there.
      expect(outboxFor(id)[0]!.text).toBe(`\\${REF}\nNo`)
      expect(refsIn(outboxFor(id)[0]!.text)).toHaveLength(0)
    } finally { w.unmount() }
  })

  it('sends a long pasted fixture without rewriting its content', async () => {
    const id = 'ref-long-paste'
    const { w, field } = await mount(id)
    const content = ['Expected output:', REF, ...Array.from({ length: 15 }, (_, i) => `Fixture line ${i}`)].join('\n')
    try {
      paste(field.element, content)
      await flushPromises()
      expect(useDraft(id).atts).toHaveLength(1)
      await w.find('button.prompt-send').trigger('click')
      expect(outboxFor(id)[0]!.text).toBe(content)
    } finally { w.unmount() }
  })

  it('loads a legacy whole-message draft into a reference and preserves the answer', async () => {
    const id = 'ref-legacy-draft'
    localStorage.setItem(`draft:${id}`, JSON.stringify({ text: 'Yes', reply: { time: '11:37', excerpt: 'Keep the cache?' }, atts: [] }))
    const { w, field } = await mount(id)
    try {
      expect((field.element as HTMLTextAreaElement).value).toBe('↳ Quote message 11:37 : Keep the cache? —\nYes')
      expect(w.findAll('.composer-quote')).toHaveLength(1)
    } finally { w.unmount(); localStorage.removeItem(`draft:${id}`) }
  })

  it('loads a legacy quoted draft as text and sends it unchanged', async () => {
    const id = 'ref-legacy-lines'
    const text = '> Keep the cache?\nYes'
    localStorage.setItem(`draft:${id}`, JSON.stringify({ text, atts: [] }))
    const { w, field } = await mount(id)
    try {
      expect((field.element as HTMLTextAreaElement).value).toBe(text)
      expect(w.findAll('.composer-quote')).toHaveLength(0)
      await w.find('button.prompt-send').trigger('click')
      expect(outboxFor(id)[0]!.text).toBe(text)
    } finally { w.unmount(); localStorage.removeItem(`draft:${id}`) }
  })
})
