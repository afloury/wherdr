import { afterEach, describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import UserText from '~/components/UserText.vue'
import { sentPastes } from '~/utils/sentPastes'

const LOG = Array.from({ length: 40 }, (_, i) => `==> Pouring pkg-${i}--1.0.arm64_sonoma.bottle.tar.gz`).join('\n')
const text = `Why does this fail?\n\n${LOG}`

describe('UserText pasted tiles', () => {
  afterEach(() => { sentPastes.value = [] })

  it('preserves blank lines between paragraphs in the bubble DOM', async () => {
    const text = 'First paragraph.\n\nSecond paragraph.\n\n\nThird paragraph.'
    const w = await mountSuspended(UserText, { props: { text } })
    expect(w.find('.msg-fold').element.textContent).toBe(text)
    w.unmount()
  })

  // A device that did not send the message only knows what the server lists.
  it('shows the paste the server lists as a tile, on a device that never sent it', async () => {
    const w = await mountSuspended(UserText, { props: { text, pasted: [LOG] } })
    expect(w.findAll('.att-tile')).toHaveLength(1)
    expect(w.find('[data-slot="name"]').text()).toBe('Pasted text')
    expect(w.find('[data-slot="description"]').text()).toBe('40 lines')
    expect(w.find('.att-tile-badge').text()).toBe('LOG')
    expect(w.find('.att-tile-text').text().split('\n')[0]).toBe('==> Pouring pkg-0--1.0.arm64_sonoma.bottle.tar.gz')
    expect(w.text()).toContain('Why does this fail?')
    expect(w.text()).not.toContain('pkg-39')
    w.unmount()
  })

  it('shows the same single tile on the device that sent it', async () => {
    sentPastes.value = [LOG]
    const w = await mountSuspended(UserText, { props: { text, pasted: [LOG] } })
    expect(w.findAll('.att-tile')).toHaveLength(1)
    expect(w.text()).not.toContain('pkg-39')
    w.unmount()
  })

  it('keeps the whole text a message when nothing lists a paste', async () => {
    const w = await mountSuspended(UserText, { props: { text } })
    expect(w.findAll('.att-tile')).toHaveLength(0)
    expect(w.text()).toContain('pkg-39')
    w.unmount()
  })
})
