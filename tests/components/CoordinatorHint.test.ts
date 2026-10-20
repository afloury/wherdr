import { describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent, h } from 'vue'
import { UApp } from '#components'
import CoordinatorHint from '~/components/CoordinatorHint.vue'

describe('Coordinator role hints', () => {
  it('a touch long press shows the hint and suppresses opening the conversation', async () => {
    const click = vi.fn()
    const Host = defineComponent({ render: () => h(UApp, null, () => h(CoordinatorHint, { text: 'All work' }, () => h('button', { onClick: click }, 'Coordinator'))) })
    const w = await mountSuspended(Host)
    vi.useFakeTimers()
    try {
      const hint = w.find('.coordinator-hint')
      await hint.trigger('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10 })
      await vi.advanceTimersByTimeAsync(460)
      expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain('All work')
      await vi.advanceTimersByTimeAsync(1200)
      await hint.trigger('pointerup')
      await hint.find('button').trigger('click')
      expect(click).not.toHaveBeenCalled()
    } finally { w.unmount(); vi.useRealTimers() }
  })
})
