import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import TaskLimitGauges from '~/components/TaskLimitGauges.vue'
import type { TaskLimits } from '#shared/projectsTasks'

const limits = (l: Partial<TaskLimits>): TaskLimits => ({ time: 'none', timeUsed: '', timeUsedMs: null, tokens: 'none', tokensUsed: null, tokensCounted: null, stopped: null, ...l })

describe('task limit gauges', () => {
  it('one gauge per limit set: this run’s time, the task’s tokens', async () => {
    const w = await mountSuspended(TaskLimitGauges, { props: { limits: limits({ time: '2h', timeUsed: '2m38s', timeUsedMs: 158_000, tokens: '30m', tokensCounted: 3_400_000, tokensUsed: 3_400_000 }) } })
    const rows = w.findAll('.task-limit')
    expect(rows.map(r => r.attributes('data-kind'))).toEqual(['time', 'tokens'])
    expect(rows[0]!.find('.task-limit-label').text()).toBe('Time')
    expect(rows[0]!.find('.task-limit-value').text()).toBe('2 min 38 / 2 h')
    expect(rows[1]!.find('.task-limit-value').text()).toBe('3.4 M / 30 M')
    expect(rows[1]!.find('.task-limit-bar > i').attributes('style')).toContain('width: 11.33')
    expect(rows.some(r => r.classes('hot'))).toBe(false)
    w.unmount()
  })
  it('red from 90 % on, full past the limit', async () => {
    const w = await mountSuspended(TaskLimitGauges, { props: { limits: limits({ tokens: '30m', tokensCounted: 31_000_000 }) } })
    const g = w.find('.task-limit')
    expect(g.classes()).toContain('hot')
    expect(g.find('.task-limit-bar > i').attributes('style')).toContain('width: 100%')
    expect(g.find('.task-limit-bar').attributes('role')).toBe('meter')
    w.unmount()
  })
  it('stopped at its time limit: what the run had taken', async () => {
    const w = await mountSuspended(TaskLimitGauges, { props: { limits: limits({ time: '2h', stopped: { what: 'time', limit: '2h', used: 7_201_000 } }) } })
    expect(w.find('.task-limit-value').text()).toBe('2 h / 2 h')
    expect(w.find('.task-limit').classes()).toContain('hot')
    w.unmount()
  })
  it('hidden when no limit is set', async () => {
    const w = await mountSuspended(TaskLimitGauges, { props: { limits: limits({ tokensUsed: 0, tokensCounted: 0 }) } })
    expect(w.find('.task-limits').exists()).toBe(false)
    w.unmount()
  })
})
