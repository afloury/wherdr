import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import TaskLimitGauges from '~/components/TaskLimitGauges.vue'
import type { TaskDetails } from '#shared/projectsTasks'

type Limits = NonNullable<TaskDetails['limits']>
const limits = (l: Partial<Limits>): Limits => ({ time: 'none', timeUsed: '', tokens: 'none', tokensUsed: null, ...l })
const text = (s: string) => s.replace(/\s+/g, ' ').trim()

describe('task limit gauges', () => {
  it('one gauge per limit set: this run’s time, the task’s tokens', async () => {
    const w = await mountSuspended(TaskLimitGauges, { props: { limits: limits({ time: '2h', timeUsed: '2m38s', timeUsedMs: 158_000, tokens: '30m', tokensCounted: 3_400_000, tokensUsed: 3_400_000 }) } })
    const rows = w.findAll('.task-limit')
    expect(rows.map(r => r.attributes('data-kind'))).toEqual(['time', 'tokens'])
    expect(rows[0]!.find('.task-limit-label').text()).toBe('Time · this run')
    expect(text(rows[0]!.find('.task-limit-value').text())).toBe('2 min 38 / 2 h')
    expect(text(rows[1]!.find('.task-limit-value').text())).toBe('3.4 M / 30 M')
    expect(rows[1]!.find('.task-limit-bar > i').attributes('style')).toContain('width: 11.33')
    expect(rows.some(r => r.classes('hot'))).toBe(false)
    // Counted and whole-task tokens are the same: no second line.
    expect(w.find('.task-limit-total').exists()).toBe(false)
    w.unmount()
  })
  it('red from 90 % on, full past the limit', async () => {
    const w = await mountSuspended(TaskLimitGauges, { props: { limits: limits({ tokens: '30m', tokensCounted: 31_000_000, tokensUsed: 31_000_000 }) } })
    const g = w.find('.task-limit[data-kind="tokens"]')
    expect(g.classes()).toContain('hot')
    expect(g.find('.task-limit-bar > i').attributes('style')).toContain('width: 100%')
    expect(g.find('.task-limit-bar').attributes('role')).toBe('meter')
    w.unmount()
  })
  it('stopped at its time limit: what the run had taken', async () => {
    const w = await mountSuspended(TaskLimitGauges, { props: { limits: limits({ time: '2h', stopped: 'time', stoppedUsed: 7_201_000 }) } })
    expect(text(w.find('.task-limit[data-kind="time"] .task-limit-value').text())).toBe('2 h / 2 h')
    expect(w.find('.task-limit[data-kind="time"]').classes()).toContain('hot')
    w.unmount()
  })
  it('a limit not set: said in words, no gauge; the whole task’s tokens when they differ', async () => {
    const w = await mountSuspended(TaskLimitGauges, { props: { limits: limits({ tokens: '30m', tokensCounted: 3_000_000, tokensUsed: 5_100_000 }) } })
    expect(text(w.find('.task-limit[data-kind="time"] .task-limit-value').text())).toBe('— / No limit')
    expect(w.find('.task-limit[data-kind="time"]').classes()).toContain('unset')
    expect(w.find('.task-limit[data-kind="time"] .task-limit-bar').exists()).toBe(false)
    expect(text(w.find('.task-limit-total').text())).toBe('Whole task · 5.1 M')
    w.unmount()
  })
})
