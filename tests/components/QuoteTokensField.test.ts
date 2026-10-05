import { afterEach, describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import QuoteTokensField from '~/components/QuoteTokensField.vue'

const mounted: { unmount: () => void }[] = []
afterEach(() => { mounted.splice(0).forEach(w => w.unmount()) })

// Mounted like the Composer does: v-model bound, the parent passing every update back.
async function mount(text: string, enterSends = true) {
  const model = { text }
  const w = await mountSuspended(QuoteTokensField, {
    props: {
      'modelValue': text,
      enterSends,
      'onUpdate:modelValue': (v: string) => {
        model.text = v
        void w.setProps({ modelValue: v })
      },
    },
    // In the document, as in the app: token removal relies on isConnected.
    attachTo: document.body,
  })
  mounted.push(w)
  return { w, model }
}

describe('QuoteTokensField', () => {
  it('draws each quote as a token above the answer', async () => {
    const { w } = await mount('> first line\n> second line\nMy answer')
    const tokens = w.findAll('.rb-token')
    expect(tokens).toHaveLength(1)
    expect(tokens[0]!.find('.rb-token-text').text()).toBe('first line second line')
    expect(w.text()).toContain('My answer')
  })

  it('removing a token keeps the answer in the draft', async () => {
    // happy-dom has no editing commands: behaves like a browser that refuses
    // to delete the non-editable token, the case the component handles itself.
    Object.assign(document, { execCommand: () => false })
    const { w, model } = await mount('> quoted text\nMy answer')
    await w.find('.rb-token-x').trigger('click')
    expect(w.find('.rb-token').exists()).toBe(false)
    expect(model.text).toBe('My answer')
  })

  it('Enter sends when enterSends is on, Shift+Enter does not', async () => {
    const { w } = await mount('> quoted\nanswer')
    await w.trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(w.emitted('submit')).toBeUndefined()
    await w.trigger('keydown', { key: 'Enter' })
    expect(w.emitted('submit')).toHaveLength(1)
  })

  it('Enter never sends when enterSends is off', async () => {
    const { w } = await mount('answer', false)
    await w.trigger('keydown', { key: 'Enter' })
    expect(w.emitted('submit')).toBeUndefined()
  })

  it('an outside change of the draft redraws the field', async () => {
    const { w } = await mount('answer')
    await w.setProps({ modelValue: '> new quote\nanswer' })
    expect(w.find('.rb-token-text').text()).toBe('new quote')
  })
})
