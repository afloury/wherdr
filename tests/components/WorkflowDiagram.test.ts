import { expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import WorkflowDiagram from '~/components/WorkflowDiagram.vue'
import WorkflowChange from '~/components/WorkflowChange.vue'
import PartHead from '~/components/PartHead.vue'
import { EXAMPLES } from '#shared/pm/examples'
import { workflowFlow } from '#shared/pm/flow'
import type { Template } from '#shared/pm/workflow'

const steps = (w: Awaited<ReturnType<typeof mountSuspended>>) => w.findAll('[data-testid="workflow-diagram-step"]').map(s => s.text().replace('→', '').trim())

it('draws a workflow as linked steps, each with who holds it', async () => {
  const github = EXAMPLES.find(e => e.id === 'github') as Template
  const w = await mountSuspended(WorkflowDiagram, { props: { steps: workflowFlow(github) } })
  expect(steps(w)).toEqual(['todoNo agent', 'workWorker', 'prNo agent', 'reviewReviewer', 'mergeNo agent', 'doneNo agent'])
  expect(w.findAll('.wf-arrow')).toHaveLength(5)
})

it('marks the steps a change adds or hands to someone else', async () => {
  const before = [{ id: 'work', holder: 'worker' }, { id: 'merge', holder: 'none' }] as const
  const after = [{ id: 'work', holder: 'worker' }, { id: 'review', holder: 'reviewer' }, { id: 'merge', holder: 'coordinator' }] as const
  const w = await mountSuspended(WorkflowDiagram, { props: { steps: [...after], compare: [...before] } })
  expect(w.findAll('.wf-step.changed').map(s => s.find('b').text())).toEqual(['review', 'merge'])
})

it('a workflow change card in the chat: subtitle, before and after, Review opens the Workflow tab', async () => {
  const flow = { before: [{ id: 'work', holder: 'worker' as const }], after: [{ id: 'work', holder: 'worker' as const }, { id: 'review', holder: 'reviewer' as const }] }
  const w = await mountSuspended(WorkflowChange, { props: { link: true, c: { project: 'CO', name: 'Company', proposal: { diff: '+ x', at: 1, said: 'Add a review', flow } } } })
  expect(w.find('.mono-label').text()).toBe('Workflow change')
  expect(w.find('[data-testid="part-subtitle"]').text()).toBe('How each task runs, step by step')
  expect(w.findAll('figcaption').map(f => f.text())).toEqual(['Before', 'After'])
  expect(w.find('[data-testid="proposal-review-link"]').attributes('href')).toBe('#/settings?section=projects&project=CO&tab=workflow&review=1')
})

it('the Workflow tab\'s head links to the Autopilot tab', async () => {
  const w = await mountSuspended(PartHead, { props: { part: 'workflow', project: 'CO' } })
  expect(w.find('[data-testid="part-link"]').text()).toBe('Who starts tasks and when: Autopilot tab')
  expect(w.find('[data-testid="part-link"]').attributes('href')).toBe('#/settings?section=projects&project=CO&tab=autopilot')
})
