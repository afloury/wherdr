import { describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import UsageLimitCard from '~/components/UsageLimitCard.vue'
const limit = { resets: '11pm', automatic: true, credits: true, resetLink: true }

describe('UsageLimitCard', () => {
  it('shows the reset, sends only Escape and opens credits on request', async () => {
    const sendKeys = vi.fn(async () => {})
    const w = await mountSuspended(UsageLimitCard, { props: { limit, readOnly: false, sendKeys } })
    expect(w.text()).toContain('11pm')
    expect(w.find('a').attributes('href')).toBe('https://clau.de/reset')
    const buttons = w.findAll('button')
    await buttons[0]!.trigger('click')
    expect(sendKeys).toHaveBeenCalledExactlyOnceWith(['esc'])
    await buttons[1]!.trigger('click')
    expect(w.emitted('credits')).toHaveLength(1)
    w.unmount()
  })
  it('disables writes offline and hides actions absent from the live screen', async () => {
    const w = await mountSuspended(UsageLimitCard, { props: { limit, readOnly: true, sendKeys: vi.fn() } })
    expect(w.findAll('button').every(b => b.attributes('disabled') !== undefined)).toBe(true)
    await w.setProps({ limit: { resets: null, automatic: false, credits: false, resetLink: false } })
    expect(w.findAll('button, a')).toHaveLength(0)
    w.unmount()
  })
})
