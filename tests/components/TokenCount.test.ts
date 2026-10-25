import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import TokenCount from '~/components/TokenCount.vue'

describe('exact token counts', () => {
  it('reveals and hides the exact count on activation and resets on new data', async () => {
    const wrapper = await mountSuspended(TokenCount, { props: { value: 41088783 } })
    expect(wrapper.get('button').text()).toBe('41M')
    expect(wrapper.get('button').attributes('title')).toBe('41088783')
    await wrapper.get('button').trigger('click')
    expect(wrapper.get('button').attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('.token-count-exact').text()).toBe('(41088783)')
    await wrapper.get('button').trigger('click')
    expect(wrapper.find('.token-count-exact').exists()).toBe(false)
    await wrapper.get('button').trigger('click')
    await wrapper.setProps({ value: '30m' })
    expect(wrapper.get('button').text()).toBe('30M')
    expect(wrapper.get('button').attributes('title')).toBe('30000000')
    expect(wrapper.find('.token-count-exact').exists()).toBe(false)
    await wrapper.setProps({ value: null })
    expect(wrapper.text()).toBe('—')
    expect(wrapper.find('button').exists()).toBe(false)
    wrapper.unmount()
  })
})
