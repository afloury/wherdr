import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ChatMarkdown from '~/components/ChatMarkdown.vue'
import { encryptedText, reducedMotion, typewriterSpeed } from '~/composables/useHerdr'

const html = `<p>${'The cache keeps every user in memory and never clears it. '.repeat(6)}</p>`
const trail = (root: Element) => root.querySelectorAll('.tw-trail [data-g]')

// Mounted first (slow on a small machine), then the reveal starts as if begun
// one second ago: the writing front is ahead, the deciphering one behind.
async function mountTyping(props: { cipher?: boolean } = {}) {
  const w = await mountSuspended(ChatMarkdown, { props: { html, typing: null, ...props } })
  await w.setProps({ typing: Date.now() - 1000 })
  return w
}

describe('ChatMarkdown encrypted text', () => {
  beforeEach(() => {
    typewriterSpeed.value = 'slow'
    encryptedText.value = true
    reducedMotion.value = false
  })
  afterEach(() => {
    typewriterSpeed.value = 'fast'
    encryptedText.value = false
  })

  // Regression: a `cipher?: boolean` prop without an `undefined` default was
  // cast to false by Vue, which switched the encrypted text off everywhere.
  it('follows the setting when no cipher prop is given', async () => {
    const w = await mountTyping()
    expect(trail(w.element).length).toBeGreaterThan(0)
    w.unmount()
  })

  it('shows no glyphs with cipher: false', async () => {
    const w = await mountTyping({ cipher: false })
    expect(trail(w.element)).toHaveLength(0)
    expect(w.text()).not.toBe('')
    w.unmount()
  })

  it('shows no glyphs once the setting is off', async () => {
    encryptedText.value = false
    const w = await mountTyping()
    expect(trail(w.element)).toHaveLength(0)
    w.unmount()
  })

  it('a tap reveals the full text and drops the glyphs', async () => {
    const w = await mountTyping()
    await w.find('.md-body').trigger('click')
    expect(trail(w.element)).toHaveLength(0)
    expect(w.text()).toContain('never clears it.')
    expect(w.emitted('done')).toHaveLength(1)
    w.unmount()
  })
})
