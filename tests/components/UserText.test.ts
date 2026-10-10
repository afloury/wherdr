import { afterEach, describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import UserText from '~/components/UserText.vue'
import { sentPastes } from '~/utils/sentPastes'

const LOG = Array.from({ length: 40 }, (_, i) => `==> Pouring pkg-${i}--1.0.arm64_sonoma.bottle.tar.gz`).join('\n')
const text = `Why does this fail?\n\n${LOG}`

describe('UserText pasted cards', () => {
  afterEach(() => { sentPastes.value = [] })

  // A device that did not send the message only knows what the server lists.
  it('shows the paste the server lists as a card, on a device that never sent it', async () => {
    const w = await mountSuspended(UserText, { props: { text, pasted: [LOG] } })
    expect(w.findAll('.pasted-card')).toHaveLength(1)
    expect(w.find('.pasted-head').text()).toContain('40 lines')
    expect(w.find('.pasted-line').text()).toBe('==> Pouring pkg-0--1.0.arm64_sonoma.bottle.tar.gz')
    expect(w.text()).toContain('Why does this fail?')
    expect(w.text()).not.toContain('pkg-39')
    w.unmount()
  })

  it('shows the same single card on the device that sent it', async () => {
    sentPastes.value = [LOG]
    const w = await mountSuspended(UserText, { props: { text, pasted: [LOG] } })
    expect(w.findAll('.pasted-card')).toHaveLength(1)
    expect(w.text()).not.toContain('pkg-39')
    w.unmount()
  })

  it('keeps the whole text a message when nothing lists a paste', async () => {
    const w = await mountSuspended(UserText, { props: { text } })
    expect(w.findAll('.pasted-card')).toHaveLength(0)
    expect(w.text()).toContain('pkg-39')
    w.unmount()
  })
})
