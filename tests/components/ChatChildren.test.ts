import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ChatQuestionBar from '~/components/ChatQuestionBar.vue'
import ChatRunningTime from '~/components/ChatRunningTime.vue'
import { addQuote } from '~/utils/questionReply'
import { messageId, pointRef } from '#shared/reference'

const rid = messageId({ ts: '2026-01-01T10:00:00Z', text: 'Keep the old name?' })

describe('question bar', () => {
  it('reads the quoted state from the draft and emits the reference', async () => {
    const targets = { questions: [{ n: '1', text: 'Keep the old name?', closed: true }], rows: [], points: 0, pick: false }
    const w = await mountSuspended(ChatQuestionBar, { props: { paneId: 'w1:p9', targets, time: '10:00', rid, picking: false } })
    const row = w.find('.q-row')
    expect(row.classes()).not.toContain('quoted')
    await row.trigger('click')
    const ref = pointRef('Keep the old name?', '10:00', rid)
    expect(w.emitted('quote')).toEqual([[ref]])
    useDraft('w1:p9').text = addQuote('', ref) || ''
    await nextTick()
    expect(w.find('.q-row').classes()).toContain('quoted')
    expect(w.find('.q-row b').text()).toBe('✓')
    await w.findAll('.q-row-ans')[1]!.trigger('click')
    expect(w.emitted('answer')?.[0]?.slice(0, 2)).toEqual([ref, 'no'])
    useDraft('w1:p9').text = ''
  })
})

describe('running time', () => {
  afterEach(() => { vi.useRealTimers() })

  it('ticks once a second on its own', async () => {
    vi.useFakeTimers({ now: 100_000 })
    const w = await mountSuspended(ChatRunningTime, { props: { since: 100_000 - 5000 } })
    expect(w.text()).toBe('Running · 5 s')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(w.text()).toBe('Running · 1 min 05 s')
    w.unmount()
  })
})
