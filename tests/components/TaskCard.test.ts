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
  it('puts its pull request beside the title, as a link', async () => {
    const w = await mountSuspended(TaskCard, { props: { task: row({ msg: 'See https://github.com/acme/app/pull/484.' }) } })
    const pr = w.find('.task-card-title a.task-card-pr')
    expect(pr.text()).toBe('PR #484')
    expect(pr.attributes('href')).toBe('https://github.com/acme/app/pull/484')
    expect(pr.attributes('target')).toBe('_blank')
    // The tags below no longer repeat it.
    expect(w.find('.task-chips').text()).not.toContain('#484')
  })
  it('opens the task from its button, not from its pull request link', async () => {
    const w = await mountSuspended(TaskCard, { props: { task: row({ state: 'working', kind: '', stage: 'working', msg: 'Writing tests' }) } })
    expect(w.find('.task-needs-type').exists()).toBe(false)
    await w.find('.task-card-open').trigger('click')
    expect(w.emitted('open')).toHaveLength(1)
  })
})
