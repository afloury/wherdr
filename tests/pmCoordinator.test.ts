import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPmStore } from '../server/utils/pmStore'
import { issueToken, noteTurn, runCommand, userMessageTo } from '../server/utils/pmCoordinator'
import { parseCommand, roleFiles, coordinatorArgs } from '../shared/pm/coordinator'
import { EXAMPLES, common, company } from '../shared/pm/examples'
import { onEvent, planSteps, type StepState } from '../shared/pm/steps'
import type { Finding } from '../shared/pm/verdict'
import type { Template } from '../shared/pm/workflow'
import type { CoreAdminDeps } from '../server/utils/coreCreate'
// @ts-expect-error plain JavaScript module
import { pm } from '../bin/lib/pm.mjs'

let dir = '', store: ReturnType<typeof createPmStore>, token = ''
const deps = () => ({ store }) as unknown as CoreAdminDeps & { store: typeof store }
const cli = (argv: string[], input?: string, tk = token) => runCommand(deps(), tk, { argv, ...(input !== undefined ? { input } : {}) })
const refused = (p: Promise<unknown>, message: RegExp | string) => expect(p).rejects.toThrow(message)
const state = (at: number, more: Partial<StepState> = {}): StepState => ({ at, started: true, proofs: {}, rounds: {}, ...more })

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-coord-'))
  store = createPmStore(dir)
  await store.setEnabled(true)
  await store.saveTemplate(company)
  await store.saveTemplate(common)
  await fs.writeFile(store.files.projects, JSON.stringify({ v: 1, projects: [
    { key: 'CO', name: 'Company', machine: '', path: '/src/co', template: 'company', addedAt: 1 },
    { key: 'ST', name: 'Studies', machine: '', path: '/src/st', template: 'common', addedAt: 1 },
  ] }))
  token = await issueToken(store, 'CO')
})
afterEach(() => fs.rm(dir, { recursive: true, force: true }))

describe('the token', () => {
  it('works for its own project only, and a new one replaces it', async () => {
    const other = await store.addTask({ project: 'ST', title: 'Study', type: 'study' })
    await refused(cli(['show', other.id]), 'Unknown task')
    await refused(cli(['list'], undefined, 'f'.repeat(64)), 'Unknown coordinator token')
    const mine = await store.addTask({ project: 'CO', title: 'Fix', type: 'feature' })
    expect((await cli(['list']) as { tasks: { id: string }[] }).tasks.map(t => t.id)).toEqual([mine.id])
    const fresh = await issueToken(store, 'CO')
    await refused(cli(['list']), 'Unknown coordinator token')
    await expect(cli(['list'], undefined, fresh)).resolves.toBeTruthy()
  })

  it('tags and links a task, each written to its log with who did it', async () => {
    const task = await store.addTask({ project: 'CO', title: 'Fix', type: 'feature' })
    await cli(['task', 'tag', task.id, 'CTP-264'])
    await cli(['task', 'link', task.id, 'https://example.com/pr/7', '--label', 'PR'])
    const saved = (await store.task(task.id))!
    expect(saved).toMatchObject({ tags: ['CTP-264'], links: [{ label: 'PR', url: 'https://example.com/pr/7' }] })
    expect(saved.log!.map(l => [l.by, l.text])).toEqual([['coordinator CO', 'tag CTP-264'], ['coordinator CO', 'link PR https://example.com/pr/7']])
  })
})

describe('template edit', () => {
  const edited = (change: (t: Template) => void) => {
    const t = structuredClone(company)
    change(t)
    return JSON.stringify(t)
  }
  const moreInstructions = edited((t) => { t.instructions = 'Base branch is develop. Never run the full suite locally.' })

  it('is refused outside a turn that comes from the user', async () => {
    await refused(cli(['template', 'edit'], moreInstructions), 'only for a turn that comes from the user')
    await noteTurn(store, 'CO', 'wake')
    await refused(cli(['template', 'edit'], moreInstructions), 'only for a turn that comes from the user')
    expect((await store.template('company'))!.version).toBe(1)
  })

  it('in a user turn: saved, with the diff, and logged with the user\'s sentence', async () => {
    await store.saveCoordinator({ ...(await store.coordinator('CO'))!, terminal: 'host/t9' })
    await userMessageTo(store, 'host/t9', 'Tell agents to never run the full suite')
    const r = await cli(['template', 'edit'], moreInstructions) as { version: number, changes: string[] }
    expect(r.version).toBe(2)
    expect(r.changes.length).toBeGreaterThan(0)
    expect((await store.templateLog('company')).at(-1)).toMatchObject({ by: 'coordinator CO', version: 2, said: 'Tell agents to never run the full suite' })
  })

  it('never changes a guard with the token, even in a user turn', async () => {
    await noteTurn(store, 'CO', 'user', 'let the engine merge develop')
    const loosen = edited((t) => { t.guards = { protected: ['main'], merge: { protected: 'user', others: 'engine' } } })
    await refused(cli(['template', 'edit'], loosen), 'Guards')
    const typeGuard = edited((t) => { t.taskTypes.feature!.guards = { merge: { others: 'engine' } } })
    await refused(cli(['template', 'edit'], typeGuard), 'Guards')
    await refused(cli(['template', 'edit'], edited((t) => { t.id = 'mine' })), 'its project\'s template only')
    expect((await store.template('company'))!.version).toBe(1)
  })
})

describe('step done', () => {
  it('--user-said ends a step that waits for the user in a user turn, never in a wake', async () => {
    const task = await store.addTask({ project: 'ST', title: 'Split', type: 'feature-split' })
    await store.saveTask({ ...task, state: 'working', step: state(1, { yourTurn: { reason: 'user', badge: 'Create these tasks' } }) })
    const st = await issueToken(store, 'ST')
    const done = ['step', 'done', task.id, '--user-said', 'Yes, create them']
    await noteTurn(store, 'ST', 'wake')
    await refused(cli(done, undefined, st), 'not a wake')
    await noteTurn(store, 'ST', 'user', 'Yes, create them')
    await cli(done, undefined, st)
    const saved = (await store.task(task.id))!
    expect(saved.step).toMatchObject({ done: true })
    expect(saved.log!.at(-1)).toMatchObject({ by: 'coordinator ST', text: 'pick: the user said "Yes, create them"' })
  })

  it('ends only a step the coordinator holds; its recheck reminds it', async () => {
    const task = await store.addTask({ project: 'CO', title: 'Fix', type: 'feature' })
    await store.saveTask({ ...task, state: 'working', step: state(1) })
    await refused(cli(['step', 'done', task.id]), 'held by the worker')
    const plan = planSteps(company, { type: 'feature' })
    const atDeploy = state(5, { recheckAt: 1000 })
    expect(onEvent(plan, atDeploy, { kind: 'tick' }, 1000).effects).toEqual([expect.objectContaining({ kind: 'instruct', step: 'deploy', holder: 'coordinator' })])
    await store.saveTask({ ...task, state: 'working', step: atDeploy })
    await cli(['step', 'done', task.id, '--link', 'https://ci.example.com/run/1'])
    expect((await store.task(task.id))!.step).toMatchObject({ done: true, proofs: { deploy: { link: 'https://ci.example.com/run/1' } } })
  })
})

describe('arbitration after N send-backs', () => {
  const f = (id: string, more: Partial<Finding> = {}): Finding => ({ id, severity: 'major', title: id, proof: 'npm test', ...more })
  const decide = (task: string, choice: string, reason = 'The finding is real and small.') => cli(['task', 'decide', task, choice, '--reason', reason])
  const atReview = async (rounds: Finding[][]) => {
    const task = await store.addTask({ project: 'CO', title: 'Fix', type: 'feature' })
    const plan = planSteps(company, { type: 'feature' })
    let s = state(2)
    for (const fs of rounds) s = onEvent(plan, { ...s, at: 2 }, { kind: 'verdict', from: 'reviewer', findings: fs }, 1).state
    await store.saveTask({ ...task, state: 'working', step: s })
    return task.id
  }

  it('picks among the engine\'s options, with its reason in the task\'s log', async () => {
    const id = await atReview([[f('a')], [f('a')], [f('b')]])
    await refused(decide(id, 'pass'), 'may only choose round or split')
    await decide(id, 'round')
    expect((await store.task(id))!.log!.at(-1)).toMatchObject({ by: 'coordinator CO', text: expect.stringContaining('coordinator chose round') })
    expect((await store.task(id))!.log!.at(-1)!.text).toContain('The finding is real and small.')
  })

  it('never passes a critical with proof', async () => {
    const id = await atReview([[f('a')], [f('a')], [f('c', { severity: 'critical' })]])
    for (const choice of ['pass', 'worker', 'split']) await refused(decide(id, choice), 'This one is for the user')
  })

  it('needs one sentence of reason', () => {
    expect(parseCommand(['task', 'decide', 'CO-1', 'round'])).toMatchObject({ error: expect.stringContaining('one sentence') })
    expect(parseCommand(['task', 'decide', 'CO-1', 'round', '--reason', 'a\nb'])).toMatchObject({ error: expect.stringContaining('one sentence') })
    expect(parseCommand(['task', 'decide', 'CO-1', 'maybe', '--reason', 'x'])).toMatchObject({ error: expect.stringContaining('choice') })
  })
})

describe('role files', () => {
  it('say who it is, its commands, each plan and the user\'s instructions, all inside its own folder', () => {
    const files = roleFiles({ key: 'CO', name: 'Company', machine: '', path: '/src/co', template: 'company', addedAt: 1 }, company, EXAMPLES)
    expect(Object.keys(files).sort()).toEqual(['.claude/settings.json', '.claude/skills/wherdr-pm/SKILL.md', 'AGENTS.md', 'CLAUDE.md'])
    const agents = files['AGENTS.md']!
    expect(agents).toContain('You coordinate project CO only')
    expect(agents).toContain('`wherdr pm task link <task> <url> --label <label>`')
    expect(agents).toContain('- deploy (Deploy): holder coordinator, ends report, recheck 5m, timeout 90m')
    expect(agents).toContain('- Base branch is develop.')
    expect(agents).toContain('"id":"vibe"')
    expect(files['CLAUDE.md']).toBe('@AGENTS.md\n')
    expect(JSON.parse(files['.claude/settings.json']!).permissions.deny).toContain('Edit(//src/co/**)')
    expect(coordinatorArgs('codex', 'gpt-5', '/h/c', '/src/co')).not.toContain('--add-dir')
  })
})

it('wherdr pm sends its words with the token, and template edit sends stdin', async () => {
  const calls: { url: string, init: { headers: Record<string, string>, body: string } }[] = []
  const request = async (url: string, init: { headers: Record<string, string>, body: string }) => {
    calls.push({ url, init })
    return { ok: true, status: 200, json: async () => ({ version: 2 }) }
  }
  let printed = ''
  const out = { write: (s: string) => { printed += s } }
  async function* stdin() { yield '{"id":"company"}' }
  await pm(['template', 'edit'], { env: { WHERDR_PM_TOKEN: 'abc', WHERDR_URL: 'http://127.0.0.1:7690' }, stdin: stdin(), out, request })
  expect(calls[0]!.url).toBe('http://127.0.0.1:7690/api/pm/cli')
  expect(calls[0]!.init.headers).toMatchObject({ authorization: 'Bearer abc', origin: 'http://127.0.0.1:7690' })
  expect(JSON.parse(calls[0]!.init.body)).toEqual({ argv: ['template', 'edit'], input: '{"id":"company"}' })
  expect(printed).toContain('"version": 2')
  await expect(pm(['list'], { env: {}, request })).rejects.toThrow('WHERDR_PM_TOKEN')
})
