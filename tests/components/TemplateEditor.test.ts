import { afterEach, expect, it, vi } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { createError, getQuery, readBody } from 'h3'
import TemplateEditor from '~/components/TemplateEditor.vue'
import { company, vibe } from '#shared/pm/examples'
import type { Template } from '#shared/pm/workflow'
import { pick, selects, selectValue } from '../helpers/select'
import { NONE } from '~/utils/selectNone'

// A fake server keeping one saved template and its log.
let saved: Record<string, { template: Template, log: { at: number, by: 'user', version: number, changes: string[] }[] }> = {}
const posts: { template: Template, replace?: boolean }[] = []
registerEndpoint('/api/pm/template', {
  method: 'GET',
  handler: event => saved[String(getQuery(event).id)],
})
registerEndpoint('/api/pm/template', {
  method: 'POST',
  handler: async (event) => {
    const { template, replace } = await readBody(event)
    posts.push({ template, replace })
    const old = saved[template.id]
    if (old && !replace) throw createError({ statusCode: 409, data: { error: 'A template already has this id' } })
    const version = (old?.template.version ?? 0) + 1
    saved[template.id] = { template: { ...template, version }, log: [...old?.log ?? [], { at: 0, by: 'user', version, changes: old ? ['simple.work'] : [] }] }
    return { template: { id: template.id, version } }
  },
})

let mounted: { unmount: () => void } | null = null
afterEach(() => { mounted?.unmount(); mounted = null; saved = {}; posts.length = 0 })
const mount = async () => (mounted = await mountSuspended(TemplateEditor, { props: { templates: [{ id: 'vibe', version: 1 }] } }))
type W = Awaited<ReturnType<typeof mount>>
const json = 'textarea[data-testid="tpl-json"], [data-testid="tpl-json"] textarea'
const errors = (w: W) => w.findAll('[data-testid="tpl-errors"] li').map(l => l.text())
const plan = (w: W) => w.findAll('[data-testid="tpl-plan"] li').map(l => l.text().split(' ')[0])

it('copies an example, edits its steps in the form, previews the plan and saves it', async () => {
  const w = await mount()
  // vibe is saved: its copy takes a free id. company is not: the copy keeps its id.
  await pick(w, 'tpl-open', 'example:vibe')
  await w.find('[data-testid="tpl-mode-json"]').trigger('click')
  expect(JSON.parse((w.find(json).element as HTMLTextAreaElement).value).id).toBe('vibe-copy')
  await w.find('[data-testid="tpl-mode-steps"]').trigger('click')
  await pick(w, 'tpl-open', 'example:company')
  expect(w.findAll('[data-testid="tpl-step"]')).toHaveLength(7)
  expect(plan(w)).toEqual(['todo', 'work', 'review', 'pr', 'merge', 'deploy', 'done'])

  // The worker step held by no one: refused, with its line in the JSON.
  expect(selectValue(w, 'tpl-holder', 4)).toBe('none') // merge
  await pick(w, 'tpl-holder', 'none', 1)
  // The line of the work step's holder.
  const src = JSON.stringify(company, null, 2).split('\n')
  const line = src.findIndex((l, n) => n > src.findIndex(x => x.includes('"id": "work"')) && l.includes('"holder"')) + 1
  expect(errors(w)).toEqual([`Line ${line} · taskTypes.feature.steps[1].holder: an agent must hold a step that ends with report`])
  expect(w.find('[data-testid="tpl-save"]').attributes('disabled')).toBeDefined()
  expect(plan(w)).toEqual([])
  await pick(w, 'tpl-holder', 'worker', 1)
  expect(errors(w)).toEqual([])

  await w.find('[data-testid="tpl-add"]').trigger('click')
  expect(plan(w)).toEqual(['todo', 'work', 'review', 'pr', 'merge', 'deploy', 'done', 'step-8'])
  await w.find('[data-testid="tpl-save"]').trigger('click')
  await vi.waitFor(() => expect(w.find('[data-testid="tpl-log"]').text()).toContain('v1'))
  expect(posts[0]!.template.taskTypes.feature!.steps.at(-1)).toEqual({ id: 'step-8' })
  expect(posts[0]!.replace).toBe(false)
  expect(w.emitted('saved')).toHaveLength(1)
})

it('refuses invalid JSON with the faulty line, then saves the fixed text', async () => {
  saved.vibe = { template: { ...vibe, version: 1 }, log: [{ at: 0, by: 'user', version: 1, changes: [] }] }
  const w = await mount()
  await pick(w, 'tpl-open', 'saved:vibe')
  await vi.waitFor(() => expect(w.find('[data-testid="tpl-log"]').text()).toContain('created'))
  await w.find('[data-testid="tpl-mode-json"]').trigger('click')
  const area = w.find(json)
  const good = (area.element as HTMLTextAreaElement).value

  await area.setValue(good.replace('"ends": "report",', '"ends": "report"'))
  expect(errors(w)[0]).toMatch(/^Line \d+ · expected , or }$/)
  await area.setValue(good.replace('"ends": "report"', '"ends": "finished"'))
  expect(errors(w)[0]).toMatch(/^Line \d+ · taskTypes\.simple\.steps\[1\]\.ends: must be one of/)
  expect(w.find('[data-testid="tpl-save"]').attributes('disabled')).toBeDefined()
  // The steps form waits for a fix when the shape is broken.
  await area.setValue('{')
  await w.find('[data-testid="tpl-mode-steps"]').trigger('click')
  expect(w.findAll('[data-testid="tpl-step"]')).toHaveLength(0)
  await w.find('[data-testid="tpl-mode-json"]').trigger('click')

  await w.find(json).setValue(good.replace('npm run lint', 'npm test'))
  expect(errors(w)).toEqual([])
  await w.find('[data-testid="tpl-save"]').trigger('click')
  await vi.waitFor(() => expect(w.find('[data-testid="tpl-log"]').text()).toContain('v2'))
  expect(w.find('[data-testid="tpl-log"]').text()).toContain('simple.work')
  expect(posts[0]!.replace).toBe(true) // the template opened here
  expect(posts[0]!.template.taskTypes.simple!.steps[1]).toMatchObject({ instructions: expect.stringContaining('npm test') })
})

it('sets screenshots as a step\'s evidence: after only, before and after, or none', async () => {
  const w = await mount()
  await pick(w, 'tpl-open', 'example:company')
  const shots = () => selects(w, 'tpl-shots') // work, pr, deploy: the report steps
  const step = (id: string) => JSON.parse((w.find(json).element as HTMLTextAreaElement).value).taskTypes.feature.steps.find((s: { id?: string }) => s.id === id)
  expect(shots()).toHaveLength(3)
  await pick(w, 'tpl-shots', 'before-after', 1)
  await pick(w, 'tpl-shots', 'after', 0)
  expect(selectValue(w, 'tpl-shots', 1)).toBe('before-after')
  expect(errors(w)).toEqual([])
  await w.find('[data-testid="tpl-mode-json"]').trigger('click')
  expect(step('pr')).toMatchObject({ evidence: ['link', 'screenshots'], screenshots: 'before-after' })
  expect(step('work').evidence).toEqual(['screenshots'])
  expect(step('work').screenshots).toBeUndefined()
  await w.find('[data-testid="tpl-mode-steps"]').trigger('click')
  await pick(w, 'tpl-shots', NONE, 1)
  await w.find('[data-testid="tpl-mode-json"]').trigger('click')
  expect(step('pr').evidence).toEqual(['link'])
  expect(step('pr').screenshots).toBeUndefined()
})

it('shows a step\'s action as fields, edits it, and says what each step does', async () => {
  const w = await mount()
  await pick(w, 'tpl-open', 'example:vibe')
  const step = (id: string) => JSON.parse((w.find(json).element as HTMLTextAreaElement).value).taskTypes.simple.steps.find((s: { id?: string }) => s.id === id)
  const kind = () => w.find('[data-testid="tpl-action"]')
  // The trigger shows the chosen item's label.
  const chosen = (sel: Omit<W, 'unmount'>) => sel.text()
  const input = (id: string) => w.find(`input[data-testid="${id}"], [data-testid="${id}"] input`)
  const says = () => w.findAll('[data-testid="tpl-say"]').map(p => p.text())
  // land: merge into dev, no PR, with its plain label and sentence.
  expect(selectValue(w, 'tpl-action')).toBe('git.land')
  expect(chosen(kind())).toBe('Merge into dev (no PR)')
  expect((input('tpl-action-branch').element as HTMLInputElement).value).toBe('dev')
  expect(says()).toEqual([
    'The task waits here until it starts.',
    'The worker does the task and says when it is done.',
    'The engine merges the task’s branch into dev and pushes it, without a PR. A conflict sends it back to the agent.',
    'The task is done.',
  ])
  expect(w.find('[data-testid="tpl-plan"]').text()).toContain('without a PR')
  expect(chosen(w.findAll('[data-testid="tpl-holder"]')[2]!)).toBe('none · the engine or you')

  // Into main, protected: the sentence says the merge waits for you.
  await input('tpl-action-branch').setValue('main')
  expect(says()[2]).toContain('main is protected: it waits for you to merge.')
  // Another kind keeps the branch, as the PR's base.
  await pick(w, 'tpl-action', 'github.pr')
  await w.find('[data-testid="tpl-mode-json"]').trigger('click')
  expect(step('land').action).toEqual({ kind: 'github.pr', base: 'main' })
  await w.find('[data-testid="tpl-mode-steps"]').trigger('click')
  await pick(w, 'tpl-action', 'github.merge')
  await pick(w, 'tpl-action-method', 'squash')
  await input('tpl-action-checks').setValue('smoke, lint')
  await input('tpl-action-checks').trigger('change')
  expect(says()[2]).toBe('The engine merges the GitHub PR (squash) once smoke, lint are green.')
  expect(errors(w)).toEqual([])
  // A step that no longer ends with an action drops it.
  await pick(w, 'tpl-ends', NONE, 2)
  expect(w.find('[data-testid="tpl-action"]').exists()).toBe(false)
  await w.find('[data-testid="tpl-mode-json"]').trigger('click')
  expect(step('land')).toEqual({ id: 'land', column: 'Working' })
})
