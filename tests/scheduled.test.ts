import { describe, expect, it } from 'vitest'
import { autopilotNextAt, nextCron, parseAutopilot, parseAutomations, reconstructTimers } from '../shared/scheduled'

const start = Date.parse('2026-01-05T08:00:00Z')
const line = (r: object) => JSON.stringify(r)
const call = (name: string, input: object, id = 'tool1', timestamp = start) => line({ type: 'assistant', timestamp: new Date(timestamp).toISOString(), message: { content: [{ type: 'tool_use', name, id, input }] } })
const result = (content: unknown, id = 'tool1', is_error = false) => line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error }] } })
const create = (recurring = true) => [call('CronCreate', { cron: '0 9 * * *', recurring, prompt: 'Check the build' }), result('Created job with ID: job-1')]
const parse = (lines: string[], now = start + 60000) => reconstructTimers(lines.join('\n'), now)

describe('coordinator schedules from herdr-projects JSON', () => {
  it('selects main, machine and project autopilot without mixing goals', () => {
    const s = JSON.stringify([{ coordinator: 'main', on: false }, { coordinator: 'machine', on: true, goal: 'Machine upkeep' }, { coordinator: 'project:demo', on: true, goal: 'Ship', today: '1 of 3 added · 2 of 2 under way', settings: [{ label: 'Wakes', value: 'every 2h' }], next: 'next in 1h', wakes: [{ at: start }] }])
    expect(parseAutopilot(s, { kind: 'main' })?.on).toBe(false)
    expect(parseAutopilot(s, { kind: 'machine' })?.goal).toBe('Machine upkeep')
    expect(parseAutopilot(s, { kind: 'project', repo: 'demo' })).toMatchObject({ goal: 'Ship', frequency: 'every 2h', last: start, next: 'next in 1h', today: '1 of 3 added · 2 of 2 under way' })
    expect(parseAutopilot(s, { kind: 'project', repo: 'other' })).toBeNull()
  })
  it('treats timerAt as the previous wake when deriving the next periodic wake', () => {
    const pilot = { on: true, goal: '', today: '', last: null, next: 'next in 1h', frequency: 'every 2h · on done stuck added' }
    expect(autopilotNextAt(start - 3600000, pilot, start)).toBe(start + 3600000)
    expect(autopilotNextAt(start, { ...pilot, hours: '09:00–17:00' }, start)).toBeNull()
    expect(autopilotNextAt(start, { ...pilot, next: 'next in 10m' }, start)).toBeNull()
    expect(autopilotNextAt(start - 3 * 3600000, pilot, start)).toBeNull()
    expect(autopilotNextAt(start, { ...pilot, next: 'outside working hours' }, start)).toBeNull()
  })
  it('filters project automations, including board-wide events, and keeps firing dates and task links', () => {
    const s = JSON.stringify([{ id: 'a', repo: 'demo', on: true, name: 'Audit', trigger: 'mon 09:00', last: { at: start, task: 'demo/12' }, next: start + 1000 }, { id: 'b', repo: 'other', trigger: 'daily 09:00' }, { id: 'c', repo: 'other', trigger: 'when a task is merged, in every repo' }])
    expect(parseAutomations(s, { kind: 'project', repo: 'demo' })).toMatchObject([{ id: 'a', last: start, next: start + 1000, tasks: ['demo/12'] }, { id: 'c' }])
    expect(parseAutomations(s, { kind: 'main' })).toHaveLength(3)
    expect(parseAutomations(s, { kind: 'machine' })).toHaveLength(3)
  })
  it('distinguishes an empty board from an unsupported or broken response', () => {
    expect(parseAutopilot('[]', { kind: 'main' })).toBeNull()
    expect(parseAutomations('[]', { kind: 'main' })).toEqual([])
    expect(() => parseAutopilot('ok', { kind: 'main' })).toThrow()
    expect(() => parseAutomations('{}', { kind: 'main' })).toThrow()
  })
})

describe('Claude session timers', () => {
  it('requires a successful result and pairs results by call ID', () => {
    expect(parse([call('CronCreate', { cron: '* * * * *' })])).toEqual([])
    expect(parse([call('CronCreate', { cron: '* * * * *' }), result('permission denied', 'tool1', true)])).toEqual([])
    expect(parse(create())).toMatchObject([{ id: 'job-1', cron: '0 9 * * *', recurring: true, prompt: 'Check the build', next: start + 3600000 }])
    expect(parse([call('CronCreate', { cron: '* * * * *' }), result('{"id":"wrong"}', 'other')])).toEqual([])
  })
  it('prefers a future execution time confirmed by the tool result', () => {
    const next = start + 3700000
    expect(parse([call('CronCreate', { cron: '0 9 * * *', prompt: 'Check' }), result(JSON.stringify({ id: 'precise', nextRunAt: next }))])[0]?.next).toBe(next)
  })
  it('removes successfully deleted jobs but retains failed deletions', () => {
    const del = call('CronDelete', { id: 'job-1' }, 'delete')
    expect(parse([...create(), del, result('Deleted', 'delete')])).toEqual([])
    expect(parse([...create(), del, result('Failed', 'delete', true)])).toHaveLength(1)
  })
  it('removes fired and past one-shot timers while keeping recurring jobs', () => {
    const fire = line({ type: 'system', subtype: 'scheduled_task_fire', taskId: 'job-1', timestamp: new Date(start + 3600000).toISOString() })
    expect(parse([...create(false), fire])).toEqual([])
    expect(parse(create(false), start + 3600001)).toEqual([])
    expect(parse([...create(), fire], start + 3600001)[0]?.next).toBe(start + 25 * 3600000)
    expect(parse([...create(false), line({ scheduledTaskId: 'job-1' })])).toEqual([])
  })
  // Same shape as a real Claude Code transcript: the call has delaySeconds,
  // the result is prose without an ID, the wake time is in toolUseResult.
  const wake = (id: string, input: object, scheduledFor: number | null, timestamp = start) => [
    call('ScheduleWakeup', input, id, timestamp),
    line({ type: 'user', timestamp: new Date(timestamp).toISOString(), toolUseResult: scheduledFor ? { scheduledFor, clampedDelaySeconds: 1200, wasClamped: false } : undefined,
      message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'Next wakeup scheduled for 08:20:00 (in 1200s). If you owe the user a status update this tick, write it now.' }] } }),
  ]
  it('reconstructs a real ScheduleWakeup call from its delay and scheduledFor', () => {
    const lines = [...wake('w1', { delaySeconds: 1200, noop: true, prompt: 'continue: check e2e results', reason: 'fallback' }, start + 1200000), '{incomplete']
    expect(parse([...lines, ...lines])).toMatchObject([{ id: 'ScheduleWakeup', cron: '', recurring: false, next: start + 1200000, prompt: 'continue: check e2e results' }])
  })
  it('falls back to the delay in the result text, and shows the reason of an autonomous loop', () => {
    expect(parse(wake('w1', { delaySeconds: 900, prompt: '<<autonomous-loop-dynamic>>', reason: 'watching CI run' }, null))).toMatchObject([{ next: start + 1200000, prompt: 'watching CI run' }])
  })
  it('keeps only the latest wakeup, drops it once fired and when the loop stops', () => {
    const first = wake('w1', { delaySeconds: 1200, prompt: 'one' }, start + 1200000)
    const second = wake('w2', { delaySeconds: 1200, prompt: 'two' }, start + 1500000, start + 300000)
    expect(parse([...first, ...second], start + 400000)).toMatchObject([{ prompt: 'two', next: start + 1500000 }])
    expect(parse(first, start + 1200001)).toEqual([])
    expect(parse([...first, ...wake('w3', { stop: true }, null, start + 30000)])).toEqual([])
  })
  it('expires all jobs after seven days and does not treat unrelated prose as a firing', () => {
    expect(parse(create(), start + 7 * 86400000)).toEqual([])
    expect(parse([...create(), line({ type: 'user', message: { content: 'Deleted job-1' } })])).toHaveLength(1)
  })
})

describe('machine-zone cron calculation', () => {
  it('handles lists, ranges, steps and day-of-week in the machine zone', () => {
    expect(nextCron('0 19 * * 1', start, 'Australia/Brisbane')).toBe(start + 3600000)
    expect(nextCron('5,10 8-10/2 * * *', start)).toBe(start + 300000)
    expect(nextCron('0 9 * * 7', start)).toBe(Date.parse('2026-01-11T09:00:00Z'))
    expect(nextCron('60 * * * *', start)).toBeNull()
    expect(nextCron('*/0 * * * *', start)).toBeNull()
    expect(nextCron('not cron', start)).toBeNull()
  })
  it('skips a nonexistent local DST hour', () => {
    expect(nextCron('30 2 * * *', Date.parse('2026-03-29T00:00:00Z'), 'Europe/Paris')).toBe(Date.parse('2026-03-30T00:30:00Z'))
  })
})
