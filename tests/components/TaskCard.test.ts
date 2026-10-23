import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import TaskCard from '~/components/TaskCard.vue'
import { parseTaskRow } from '#shared/projectsTasks'

const row = (more: Record<string, unknown>) => parseTaskRow({ id: 'demo/9', title: 'Improve search', stage: 'asks', state: 'blocked', kind: 'question', app: 'claude', ...more })!

describe('TaskCard', () => {
  it('says a wait on one line: its kind, then its words with short links', async () => {
    const w = await mountSuspended(TaskCard, { props: { task: row({ msg: 'Merge\nhttps://github.com/acme/app/pull/484 or wait?' }) } })
    const line = w.find('.task-card-msg')
    expect(line.find('.task-needs-type').text()).toBe('Question')
    expect(line.find('.task-card-msg-text').text()).toBe('Merge PR #484 or wait?')
    expect(line.attributes('title')).toContain('https://github.com/acme/app/pull/484')
  })
  it('every link of its message is clickable, short, above the card', async () => {
    const w = await mountSuspended(TaskCard, { props: { task: row({ msg: 'Which endpoint should we use? https://example.com/settings' }) } })
    const a = w.find('.task-card-msg-text a[href="https://example.com/settings"]')
    expect(a.exists()).toBe(true)
    expect(a.text()).toBe('example.com/settings')
    expect(a.attributes('target')).toBe('_blank')
    await a.trigger('click')
    expect(w.emitted('open')).toBeUndefined()
  })
  it('puts its pull request beside the title, as a link', async () => {
    const w = await mountSuspended(TaskCard, { props: { task: row({ msg: 'See https://github.com/acme/app/pull/484.' }) } })
    const pr = w.find('.task-card-title a.task-card-pr')
    expect(pr.text()).toBe('PR #484')
    expect(pr.attributes('href')).toBe('https://github.com/acme/app/pull/484')
    expect(pr.attributes('target')).toBe('_blank')
    // The tags below no longer repeat it.
    expect(w.findAll('.task-chips').map(c => c.text()).join(' ')).not.toContain('#484')
  })
  it('opens the task from its button, not from its pull request link', async () => {
    const w = await mountSuspended(TaskCard, { props: { task: row({ state: 'working', kind: '', stage: 'working', msg: 'Writing tests' }) } })
    expect(w.find('.task-needs-type').exists()).toBe(false)
    await w.find('.task-card-open').trigger('click')
    expect(w.emitted('open')).toHaveLength(1)
  })
})

it('keeps the worker logo with separate reviewer and takeover marks', async () => {
  const w = await mountSuspended(TaskCard, { props: { task: { ...row({ stage: 'reviewing', app: 'claude' }), identity: { agent: 'codex', reviewer: 'claude', from: 'omp' } } } })
  expect(w.find('.task-agent-primary .avatar').classes()).toContain('codex')
  expect(w.find('.task-agent-reviewer').text()).toContain('Reviewed by')
  expect(w.find('.task-agent-reviewer .avatar').classes()).toContain('claude')
  expect(w.find('.task-agent-from').text()).toContain('Took over from')
})

describe('a Working card says what it is doing', () => {
  const working = (stage: string, msg: string, more: Record<string, unknown> = {}) => row({ state: 'working', kind: '', stage, msg, progress: 60, ...more })

  it('an agent running: its logo and progress, no badge', async () => {
    const w = await mountSuspended(TaskCard, { props: { task: working('working', 'Writing tests') } })
    expect(w.find('.task-activity').exists()).toBe(false)
    expect(w.classes()).not.toContain('activity-ci')
    expect(w.find('.task-chips').text()).toContain('60%')
  })
  it('waiting for GitHub checks: a CI badge with its tally, no progress', async () => {
    const w = await mountSuspended(TaskCard, { props: { task: working('merging', 'Waiting for GitHub checks · 1 of 2 passed') } })
    const badge = w.find('.task-activity')
    expect(badge.attributes('data-kind')).toBe('ci')
    expect(badge.text()).toBe('CI 1/2')
    expect(badge.attributes('title')).toBe('Agent done, waiting for GitHub checks: 1 of 2 passed')
    expect(w.classes()).toContain('activity-ci')
    expect(w.find('.task-chips').exists()).toBe(false)
  })
  it('queued behind a task or for a slot: a QUEUED badge with what it waits for, no progress', async () => {
    const after = await mountSuspended(TaskCard, { props: { task: working('after', 'queued after DEMO-70') } })
    expect(after.find('.task-activity').attributes('data-kind')).toBe('queued')
    expect(after.find('.task-activity').text()).toBe('Queued · DEMO-70')
    expect(after.classes()).toContain('activity-queued')
    expect(after.find('.task-chips').exists()).toBe(false)
    const slot = await mountSuspended(TaskCard, { props: { task: working('queued', 'waiting for a free slot, Q#2') } })
    expect(slot.find('.task-activity').text()).toBe('Queued · Q#2')
    expect(slot.find('.task-activity').attributes('title')).toBe('Not started: waiting for a free slot, 2nd in the queue')
  })
})
