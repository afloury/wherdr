import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import Composer from '~/components/Composer.vue'
import { eventsOpen } from '~/composables/useHerdr'
import { outboxFor } from '~/composables/useOutbox'
import type { Pane } from '#shared/types'

// Claude Code's grayed-out suggestion: Tab on a computer, a "Use" button in the field on a
// touch screen. What counts as a touch screen (utils/format.ts, read from the user agent and
// `pointer: coarse` at load) is switched here per test.
const device = vi.hoisted(() => ({ touch: false }))
vi.mock('~/utils/format', async (importOriginal) => {
  const real = await importOriginal<typeof import('~/utils/format')>()
  return {
    ...real,
    get isIOS() { return device.touch },
    get touchKeyboard() { return device.touch },
  }
})

const SUGGESTION = 'yes add the teardown and check both'
// An agent kind without a model picker: the test stays on the field.
const pane = (id: string, claudeSuggestion?: string): Pane => ({
  id, workspace: 'w1', tab: 'w1:t1', tabLabel: null, agent: 'pi', name: null, label: null, status: 'idle', title: null, cwd: '/home/user/demo', agentSession: null, claudeSuggestion,
})
const mount = (id: string, o: { suggestion?: string, unanswered?: number } = {}) =>
  mountSuspended(Composer, { props: { pane: pane(id, o.suggestion), paneId: id, sendKeys: async () => {}, unanswered: o.unanswered } })

describe('Composer suggestion', () => {
  beforeEach(() => { eventsOpen.value = true })
  afterEach(() => { eventsOpen.value = false; device.touch = false })

  describe('touch screen', () => {
    beforeEach(() => { device.touch = true })

    it('the button fills the field with the suggestion without sending it', async () => {
      const w = await mount('w4:p1', { suggestion: SUGGESTION })
      const field = w.find('textarea')
      expect(field.attributes('placeholder')).toBe(SUGGESTION)
      const use = w.find('button.prompt-suggest')
      expect(use.exists()).toBe(true)
      expect(use.attributes('aria-label')).toBe('Use suggestion')
      expect(use.text()).toBe('Use')
      await use.trigger('click')
      expect((field.element as HTMLTextAreaElement).value).toBe(SUGGESTION)
      expect(outboxFor('w4:p1')).toHaveLength(0)
      // Text in the field: no suggestion, no button.
      expect(w.find('button.prompt-suggest').exists()).toBe(false)
      // Still editable.
      await field.setValue(`${SUGGESTION}, then merge`)
      expect((field.element as HTMLTextAreaElement).value).toBe(`${SUGGESTION}, then merge`)
      // Emptied again: the button comes back.
      await field.setValue('')
      expect(w.find('button.prompt-suggest').exists()).toBe(true)
      w.unmount()
    })

    it('the button and the unanswered questions tab show together', async () => {
      const w = await mount('w4:p2', { suggestion: SUGGESTION, unanswered: 2 })
      expect(w.find('.composer-ask').text()).toContain('2 questions unanswered')
      // In the field, not above it where the tab hangs.
      expect(w.find('.prompt button.prompt-suggest').exists()).toBe(true)
      expect(w.find('.prompt').classes()).toContain('suggesting')
      w.unmount()
    })

    it('no suggestion: no button', async () => {
      const w = await mount('w4:p3', { unanswered: 1 })
      expect(w.find('button.prompt-suggest').exists()).toBe(false)
      expect(w.find('.prompt').classes()).not.toContain('suggesting')
      w.unmount()
    })
  })

  it('computer: no button, Tab takes the suggestion', async () => {
    const w = await mount('w4:p4', { suggestion: SUGGESTION })
    expect(w.find('button.prompt-suggest').exists()).toBe(false)
    const field = w.find('textarea')
    await field.trigger('keydown', { key: 'Tab' })
    expect((field.element as HTMLTextAreaElement).value).toBe(SUGGESTION)
    expect(outboxFor('w4:p4')).toHaveLength(0)
    w.unmount()
  })
})
