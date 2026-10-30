import { expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import PhoneKeybar from '~/components/PhoneKeybar.vue'
import type { TerminalCtl } from '~/composables/useTerminal'

it('hides terminal-only controls in Conversation and keeps named keys usable', async () => {
  const sendVirtualKey = vi.fn()
  const ctl = {
    virtualModifiers: ref([]), lastVirtualChord: ref(''), kbdOn: ref(false),
    sendVirtualKey, toggleVirtualModifier: vi.fn(), focus: vi.fn(), blur: vi.fn(), hasFocus: () => false,
  } as unknown as TerminalCtl
  const wrapper = await mountSuspended(PhoneKeybar, { props: { ctl, terminal: false } })
  try {
    const labels = () => wrapper.findAll('button').map(b => b.attributes('aria-label'))
    for (const name of ['Home', 'End', 'PgUp', 'PgDn', 'Delete', 'Insert', 'Show or hide the phone keyboard']) expect(labels()).not.toContain(name)
    await wrapper.findAll('button')[1]!.trigger('click')
    expect(sendVirtualKey).toHaveBeenCalledWith('esc')
    expect(wrapper.find('.vk-more').exists()).toBe(false)
    await wrapper.setProps({ terminal: true })
    expect(labels().slice(0, 16)).toEqual(['Show or hide the phone keyboard', 'Ctrl', 'Esc', 'Tab', 'Left arrow', 'Up arrow', 'Down arrow', 'Right arrow', 'Enter', 'Ctrl+C', 'Backspace', 'Home', 'End', 'PgUp', 'PgDn', 'Delete'])
  } finally { wrapper.unmount() }
})
