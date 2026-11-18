import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPmStore } from '../server/utils/pmStore'
import { splitFeature } from '../server/utils/pmFeature'
import { PLAN_WRITE_SCRIPT, planWriteCall, planWriteResult, readPlanFile, tickPlanFile } from '../server/utils/pmPlan'
import { issueToken, noteTurn, runCommand } from '../server/utils/pmCoordinator'
import { DEFAULT_AUTOPILOT } from '../shared/pm/autopilot'
import { parsePlan, parseFeature } from '../shared/pm/feature'
import { openLines, parsePlanPath, parseRefs, planCloseRefusal, planCommitMessage, skippedText, tickPlan } from '../shared/pm/planRefs'
import { instructionsText } from '../shared/pm/run'
import { parseCommand, WHERDR_SCRIPT } from '../shared/pm/coordinator'
import { defaultWorkflow } from '../shared/pm/workflow'
import type { CoreAdminDeps } from '../server/utils/coreCreate'
import type { Project } from '../shared/pm/project'
import type { Task } from '../shared/pm/run'

const PLAN = [
  '# Tasks',
  '',
  '- [ ] T010 [P] [US1] Add the endpoint',
  '- [ ] T011 [US1] Add the button (see FR-2)',
  '  - [ ] T012 Nested line, two spaces',
  '* [ ] T1 Short ID',
  '- [ ] T10 Longer ID, same start',
  '- [x] T013 Already done by hand',
  '- [ ] T014 Not a line of this task',
  '',
].join('\n')
const done = { task: 'PA-1', date: '2026-11-17', sha: '1a2b3c4' }

describe('tickPlan: ticks a plan file\'s lines by their IDs', () => {
  it('ticks the right line only and keeps its notes', () => {
    const r = tickPlan(PLAN, ['T011'], done)
    expect(r.ticked).toEqual(['T011'])
    expect(r.skipped).toEqual([])
    const lines = r.text.split('\n')
    expect(lines[3]).toBe('- [x] T011 [US1] Add the button (see FR-2) (done: PA-1, 1a2b3c4, 2026-11-17)')
    // Every other line as it was.
    expect(lines.filter((_, i) => i !== 3)).toEqual(PLAN.split('\n').filter((_, i) => i !== 3))
  })

  it('takes an ID for itself, never for the longer one it starts: T1 is not T10', () => {
    const a = tickPlan(PLAN, ['T1'], done)
    expect(a.text).toContain('* [x] T1 Short ID (done: PA-1, 1a2b3c4, 2026-11-17)')
    expect(a.text).toContain('- [ ] T10 Longer ID, same start')
    const b = tickPlan(PLAN, ['T10'], { task: 'PA-2', date: '2026-11-17' })
    expect(b.text).toContain('- [x] T10 Longer ID, same start (done: PA-2, 2026-11-17)')
    expect(b.text).toContain('* [ ] T1 Short ID')
  })

  it('keeps indentation, bullets and Windows line endings', () => {
    const r = tickPlan('- [ ] T1 One\r\n  - [ ] T2 Two\r\n', ['T2'], done)
    expect(r.text).toBe('- [ ] T1 One\r\n  - [x] T2 Two (done: PA-1, 1a2b3c4, 2026-11-17)\r\n')
  })

  it('ticks several lines, and says what it did not tick: already ticked, or not found', () => {
    const r = tickPlan(PLAN, ['T010', 'T013', 'T099'], done)
    expect(r.ticked).toEqual(['T010'])
    expect(r.skipped).toEqual([{ ref: 'T013', why: 'already ticked' }, { ref: 'T099', why: 'not found' }])
    expect(skippedText(r.skipped)).toBe('plan: T013 not ticked (already ticked); plan: T099 not ticked (not found)')
  })

  it('is idempotent: a second pass changes nothing and names the lines already ticked', () => {
    const first = tickPlan(PLAN, ['T010', 'T011'], done)
    const second = tickPlan(first.text, ['T010', 'T011'], { ...done, date: '2026-12-01' })
    expect(second.text).toBe(first.text)
    expect(second.ticked).toEqual([])
    expect(second.skipped.map(s => s.why)).toEqual(['already ticked', 'already ticked'])
  })

  it('ticks the first open line when an ID is written twice', () => {
    const r = tickPlan('- [ ] T5 one\n- [ ] T5 two\n', ['T5'], done)
    expect(r.text).toBe('- [x] T5 one (done: PA-1, 1a2b3c4, 2026-11-17)\n- [ ] T5 two\n')
  })
})

describe('refs, plan paths, open lines and the commit message', () => {
  it('checks IDs: letters, digits and dashes, ending in a number', () => {
    expect(parseRefs(['T010', ' T011 ', 'T010'])).toEqual(['T010', 'T011'])
    expect(parseRefs('US3,FR-12')).toEqual(['US3', 'FR-12'])
    expect(parseRefs(undefined)).toEqual([])
    for (const bad of ['010', 'T', 'T 1', 'T1;rm', '../x1', 'T1\nT2']) expect(parseRefs([bad])).toMatchObject({ error: expect.stringMatching(/not a plan line ID/) })
    expect(parseRefs([1])).toMatchObject({ error: expect.stringMatching(/plan line IDs/) })
    expect(parseRefs(Array.from({ length: 51 }, (_, i) => `T${i}`))).toMatchObject({ error: expect.stringMatching(/50 at most/) })
  })

  it('keeps a plan file\'s path under the root: relative, never leaving it', () => {
    expect(parsePlanPath('specs/018-x/tasks.md')).toBe('specs/018-x/tasks.md')
    expect(parsePlanPath('./tasks.md')).toBe('tasks.md')
    for (const bad of ['', '/etc/passwd', '~/tasks.md', '../tasks.md', 'a/../../b.md', 'a//b.md', '.git/config', 'a/.git/x', 'a/\u0000b']) expect(parsePlanPath(bad)).toMatchObject({ error: expect.stringMatching(/plan file under the workspace/) })
  })

  it('lists the lines still open, an ID and its first 80 characters, and refuses a close with them', () => {
    const open = openLines(PLAN)
    expect(open.map(l => l.id)).toEqual(['T010', 'T011', 'T012', 'T1', 'T10', 'T014'])
    expect(open[0]).toEqual({ id: 'T010', text: 'T010 [P] [US1] Add the endpoint' })
    expect(openLines(`- [ ] T7 ${'x'.repeat(200)}`)[0]!.text).toHaveLength(80)
    expect(planCloseRefusal('specs/x/tasks.md', openLines('- [x] T1 done\n'))).toBeUndefined()
    const why = planCloseRefusal('specs/x/tasks.md', open)!
    expect(why).toMatch(/^6 lines of specs\/x\/tasks.md still unticked: T010 \[P\] \[US1\] Add the endpoint; T011/)
    expect(why).toMatch(/Ask the user, then close with --anyway$/)
    expect(planCloseRefusal('t.md', Array.from({ length: 15 }, (_, i) => ({ id: `T${i}`, text: `T${i} x` })))).toMatch(/15 lines.*; and 3 more\./)
  })

  it('writes a commit message from the workspace\'s template, else a plain one', () => {
    const task = { id: 'PA-1', title: 'Serve payslips', type: 'task', tags: ['PAY-12'] }
    expect(planCommitMessage(undefined, 'WS-1', task, ['T010', 'T011'])).toBe('WS-1: tick T010, T011 (PA-1)')
    expect(planCommitMessage('{tag}: {title}', 'WS-1', task, ['T010'])).toBe('PAY-12: tick T010 (Serve payslips)')
    expect(planCommitMessage('[{id}] {title}', 'WS-1', { ...task, tags: [] }, ['T1'])).toBe('[PA-1] tick T1 (Serve payslips)')
    // A template the engine refuses (an unknown field): the plain message.
    expect(planCommitMessage('{nope}', 'WS-1', task, ['T1'])).toBe('WS-1: tick T1 (PA-1)')
  })
})

describe('feature split and close: the plan, the refs, --from, --anyway', () => {
  it('parses the commands', () => {
    expect(parseCommand(['feature', 'split', 'WS-1', '--from', 'specs/018/plan.json'])).toEqual({ name: 'feature split', task: 'WS-1', from: 'specs/018/plan.json' })
    expect(parseCommand(['feature', 'split', 'WS-1'])).toEqual({ name: 'feature split', task: 'WS-1' })
    expect(parseCommand(['feature', 'split', 'WS-1', '--from', ' '])).toMatchObject({ error: expect.stringMatching(/--from/) })
    expect(parseCommand(['feature', 'split', 'WS-1', '--frm', 'x'])).toEqual({ error: 'unknown option --frm' })
    expect(parseCommand(['feature', 'close', 'WS-1', '--anyway', '--reason', 'Shipped'])).toEqual({ name: 'feature close', task: 'WS-1', reason: 'Shipped', anyway: true })
    expect(parseCommand(['feature', 'close', 'WS-1'])).toEqual({ name: 'feature close', task: 'WS-1' })
    expect(parseFeature(['close', 'WS-1'], { anyway: 'yes' })).toMatchObject({ anyway: true })
    expect(parseCommand(['task', 'add', 'Show it', '--type', 'task', '--feature', 'WS-1', '--refs', 'T1, T2'])).toMatchObject({ name: 'task add', feature: 'WS-1', refs: ['T1', 'T2'] })
    expect(parseCommand(['task', 'add', 'Show it', '--type', 'task', '--refs', 'T1'])).toMatchObject({ error: expect.stringMatching(/--refs needs --feature/) })
    expect(parseCommand(['task', 'add', 'Show it', '--type', 'task', '--feature', 'WS-1', '--refs', 'x'])).toMatchObject({ error: expect.stringMatching(/--refs: x is not a plan line ID/) })
  })

  it('checks the plan: its file and each task\'s refs', () => {
    const p = parsePlan({ order: 'API first', plan: './specs/018-x/tasks.md', tasks: [{ repo: 'api', title: 'A', type: 'task', refs: ['T010', 'T011'] }, { repo: 'app', title: 'B', type: 'task' }] })
    expect(p).toMatchObject({ file: 'specs/018-x/tasks.md', tasks: [{ repo: 'api', refs: ['T010', 'T011'] }, { repo: 'app', refs: [] }] })
    expect(parsePlan({ order: 'x', tasks: [{ repo: 'api', title: 'A', type: 'task' }] })).not.toHaveProperty('file')
    expect(parsePlan({ order: 'x', plan: '../tasks.md', tasks: [{ repo: 'api', title: 'A', type: 'task' }] })).toMatchObject({ error: expect.stringMatching(/plan file under the workspace/) })
    expect(parsePlan({ order: 'x', plan: 'tasks.md', tasks: [{ repo: 'api', title: 'A', type: 'task', refs: ['T 1'] }] })).toMatchObject({ error: expect.stringMatching(/^plan.tasks\[0\].refs: T 1 is not a plan line ID/) })
    // Refs name lines of a plan file: without one, nothing to tick.
    expect(parsePlan({ order: 'x', tasks: [{ repo: 'api', title: 'A', type: 'task', refs: ['T1'] }] })).toMatchObject({ error: expect.stringMatching(/add "plan"/) })
  })

  it('tells the worker its plan lines', () => {
    const p = { key: 'PA', name: 'Payroll', machine: '', path: '/w/payroll-api', addedAt: 1 } as Project
    const task = { id: 'PA-1', project: 'PA', title: 'Serve', description: 'Do it', type: 'task', state: 'todo', createdAt: 1, refs: ['T010', 'T011'] } as Task
    const run = { worktree: '/wt', branch: 'task/PA-1' }
    const t = defaultWorkflow('PA')
    expect(instructionsText(p, t, task, run, undefined, undefined, [], 'specs/018-x/tasks.md')).toContain('Plan lines: T010, T011 in specs/018-x/tasks.md')
    expect(instructionsText(p, t, task, run)).not.toContain('Plan lines')
    expect(instructionsText(p, t, { ...task, refs: undefined }, run, undefined, undefined, [], 'specs/018-x/tasks.md')).not.toContain('Plan lines')
  })

  it('the coordinator\'s own folder script sends stdin for feature split, unless --from', () => {
    expect(WHERDR_SCRIPT).toContain('"pm/cli feature split"*')
    expect(WHERDR_SCRIPT).toContain('*" --remove "*|*" --from "*) ;;')
  })
})

// A machine that is this one: `machine.exec` runs the argv here.
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' } }).trim()
const call = async (_m: string, p: { argv: string[], input?: string }) => {
  const r = spawnSync(p.argv[0]!, p.argv.slice(1), { input: p.input ? Buffer.from(p.input, 'base64') : undefined, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' } })
  return { code: r.status, stdout: r.stdout.toString('base64'), stderr: r.stderr.toString('base64') }
}

describe('the plan file on the workspace\'s machine', () => {
  let dir = '', root = '', outside = ''
  const ws = () => ({ path: root, machine: '' }) as Project
  const deps = { call, machines: () => [{ key: '', label: 'here', local: true }] } as never
  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pm-plan-')))
    root = path.join(dir, 'root')
    outside = path.join(dir, 'outside')
    await fs.mkdir(path.join(root, 'specs'), { recursive: true })
    await fs.mkdir(outside)
    await fs.writeFile(path.join(root, 'specs/tasks.md'), PLAN)
    await fs.writeFile(path.join(outside, 'secret.md'), '- [ ] T1 secret\n')
  })
  afterEach(() => fs.rm(dir, { recursive: true, force: true }))

  it('reads a file under the root, as it is, trailing newline included', async () => {
    expect(await readPlanFile(deps, ws(), 'specs/tasks.md')).toEqual({ text: PLAN })
    expect(await readPlanFile(deps, ws(), path.join(root, 'specs/tasks.md'))).toEqual({ text: PLAN })
    expect(await readPlanFile(deps, ws(), 'specs/missing.md')).toEqual({ why: 'specs/missing.md was not found' })
    expect(await readPlanFile(deps, ws(), 'specs')).toEqual({ why: 'specs was not found' })
    expect(await readPlanFile(deps, ws(), 'specs/tasks.md', 10)).toEqual({ why: 'specs/tasks.md is too large' })
  })

  it('refuses a file outside the root: a path out of it, an absolute one, a link to it, a link in a folder', async () => {
    await fs.symlink(path.join(outside, 'secret.md'), path.join(root, 'specs/link.md'))
    await fs.symlink(outside, path.join(root, 'linked'))
    await fs.symlink('tasks.md', path.join(root, 'specs/inside.md'))
    const out = (f: string) => expect(readPlanFile(deps, ws(), f)).resolves.toEqual({ why: `${f} is outside the workspace's root` })
    await out('../outside/secret.md')
    await out(path.join(outside, 'secret.md'))
    await out('specs/link.md')
    await out('linked/secret.md')
    // A link that stays inside is the file it leads to.
    expect(await readPlanFile(deps, ws(), 'specs/inside.md')).toEqual({ text: PLAN })
  })

  it('splits from a file of the root, with the plan file and the refs kept; refuses a path outside', async () => {
    const store = createPmStore(path.join(dir, 'pm'))
    await store.setEnabled(true)
    await fs.mkdir(path.join(root, 'payroll-api'))
    await fs.mkdir(path.join(root, 'quotes-app'))
    const projects = [
      { key: 'WS', name: 'Work', machine: '', path: root, kind: 'workspace', git: false, addedAt: 1 },
      { key: 'PA', name: 'Payroll', machine: '', path: path.join(root, 'payroll-api'), workspace: 'WS', addedAt: 1 },
      { key: 'QA', name: 'Quotes', machine: '', path: path.join(root, 'quotes-app'), workspace: 'WS', addedAt: 1 },
    ]
    await fs.writeFile(store.files.projects, JSON.stringify({ v: 1, projects }))
    const feature = await store.addTask({ project: 'WS', title: 'Export payslips', type: 'feature' })
    const start = vi.fn(async () => {}), who = { by: 'coordinator WS', origin: 'user' as const }
    const d = { store, call, machines: () => [{ key: '', label: 'here', local: true }] } as unknown as CoreAdminDeps & { store: typeof store }
    const body = JSON.stringify({ order: 'API first', plan: 'specs/tasks.md', tasks: [{ repo: 'payroll-api', title: 'Serve', type: 'task', refs: ['T010'] }, { repo: 'quotes-app', title: 'Show', type: 'task', refs: ['T011', 'T012'], after: ['payroll-api'] }] })
    await fs.writeFile(path.join(root, 'specs/plan.json'), body)
    await fs.writeFile(path.join(outside, 'plan.json'), body)
    await expect(splitFeature(d, projects[0] as Project, feature, '', { ...who, from: '../outside/plan.json' }, start)).rejects.toThrow(/--from: \.\.\/outside\/plan.json is outside the workspace's root/)
    await expect(splitFeature(d, projects[0] as Project, feature, '', { ...who, from: 'specs/nope.json' }, start)).rejects.toThrow(/was not found/)
    await expect(splitFeature(d, projects[0] as Project, feature, '', { ...who, from: 'specs/tasks.md' }, start)).rejects.toThrow(/not valid JSON \(specs\/tasks.md\)/)
    // The plan file named by the plan must be there, under the root.
    const missing = JSON.stringify({ order: 'x', plan: 'specs/gone.md', tasks: [{ repo: 'payroll-api', title: 'Serve', type: 'task' }] })
    await expect(splitFeature(d, projects[0] as Project, feature, missing, who, start)).rejects.toThrow(/plan: specs\/gone.md was not found/)
    const link = JSON.stringify({ order: 'x', plan: 'specs/escape.md', tasks: [{ repo: 'payroll-api', title: 'Serve', type: 'task' }] })
    await fs.symlink(path.join(outside, 'secret.md'), path.join(root, 'specs/escape.md'))
    await expect(splitFeature(d, projects[0] as Project, feature, link, who, start)).rejects.toThrow(/plan: specs\/escape.md is outside/)
    expect((await store.tasks()).filter(t => t.feature)).toEqual([])
    // stdin keeps working: the same plan from a file, then nothing added twice.
    const r = await splitFeature(d, projects[0] as Project, feature, '', { ...who, from: 'specs/plan.json' }, start)
    expect(r).toMatchObject({ planFile: 'specs/tasks.md', tasks: [{ id: 'PA-1', refs: ['T010'] }, { id: 'QA-1', refs: ['T011', 'T012'], after: 'PA-1' }] })
    expect(await store.task('QA-1')).toMatchObject({ feature: 'WS-1', refs: ['T011', 'T012'] })
    expect(await store.task('WS-1')).toMatchObject({ plan: { order: 'API first', file: 'specs/tasks.md' } })
    // A later sub-task takes refs too; bad ones are refused by the store.
    await expect(store.addTask({ project: 'QA', title: 'More', type: 'task', feature: 'WS-1', refs: ['bad ref'] })).rejects.toThrow()
    await expect(store.addTask({ project: 'QA', title: 'More', type: 'task', refs: ['T1'] })).rejects.toThrow()
    expect(await store.addTask({ project: 'QA', title: 'More', type: 'task', feature: 'WS-1', refs: ['T013'] })).toMatchObject({ refs: ['T013'] })
  })

  describe('feature close, and the write-back once a sub-task is done', () => {
    const pmDir = () => path.join(dir, 'pm')
    let store: ReturnType<typeof createPmStore>
    const doneStep = { at: 0, started: true, done: true, proofs: {}, rounds: {} }
    const cli = (token: string, argv: string[]) => runCommand({ store, call, machines: () => [{ key: '', label: 'here', local: true }] } as unknown as CoreAdminDeps & { store: typeof store }, token, { argv })
    const setup = async (rootGit: 'none' | 'member' = 'none', more: Partial<Project> = {}) => {
      store = createPmStore(pmDir())
      await store.setEnabled(true)
      await fs.mkdir(path.join(root, 'payroll-api'), { recursive: true })
      const projects: Record<string, unknown>[] = [
        { key: 'WS', name: 'Work', machine: '', path: root, kind: 'workspace', git: false, addedAt: 1, ...more },
        { key: 'PA', name: 'Payroll', machine: '', path: path.join(root, 'payroll-api'), workspace: 'WS', addedAt: 1 },
      ]
      if (rootGit === 'member') projects.push({ key: 'RT', name: 'Root', machine: '', path: root, workspace: 'WS', addedAt: 1 })
      await fs.writeFile(store.files.projects, JSON.stringify({ v: 1, projects }))
      const feature = await store.addTask({ project: 'WS', title: 'Export', type: 'feature' })
      await store.saveTask({ ...feature, plan: { order: 'x', file: 'specs/tasks.md' } })
      const sub = await store.addTask({ project: 'PA', title: 'Serve', type: 'task', feature: feature.id, refs: ['T010', 'T011'] })
      return { feature, sub, token: await issueToken(store, 'WS') }
    }
    const finish = (id: string) => store.updateTask(id, t => ({ ...t, step: doneStep }))
    const tick = async (id: string) => tickPlanFile({ store, call, machines: () => [{ key: '', label: 'here', local: true }] } as never, id)
    const planText = () => fs.readFile(path.join(root, 'specs/tasks.md'), 'utf8')
    const initRepo = (branch = 'main') => {
      git(root, 'init', '-q', '-b', branch)
      git(root, 'add', '-A')
      git(root, 'commit', '-q', '-m', 'init')
    }

    it('refuses to close with lines of the plan file unticked, lists them, and closes with --anyway', async () => {
      const { feature, sub, token } = await setup()
      await finish(sub.id)
      await expect(cli(token, ['feature', 'close', feature.id])).rejects.toThrow(/6 lines of specs\/tasks.md still unticked: T010 \[P\] \[US1\] Add the endpoint; T011/)
      await tick(sub.id)
      await expect(cli(token, ['feature', 'close', feature.id])).rejects.toThrow(/4 lines of specs\/tasks.md still unticked: T012 Nested line/)
      await cli(token, ['feature', 'close', feature.id, '--anyway'])
      expect(await store.task(feature.id)).toMatchObject({ closed: { by: expect.any(String) } })
      expect((await store.task(feature.id))!.log!.at(-1)!.text).toMatch(/closed the feature \(--anyway: plan lines of specs\/tasks.md may be unticked\)/)
    })

    it('closes a feature whose plan file is all ticked, or that has none', async () => {
      const { feature, sub, token } = await setup()
      await fs.writeFile(path.join(root, 'specs/tasks.md'), '- [x] T010 a\n- [x] T011 b\n')
      await finish(sub.id)
      await cli(token, ['feature', 'close', feature.id])
      expect(await store.task(feature.id)).toMatchObject({ closed: expect.anything() })
      const other = await store.addTask({ project: 'WS', title: 'No plan', type: 'feature' })
      await cli(token, ['feature', 'close', other.id])
      expect(await store.task(other.id)).toMatchObject({ closed: expect.anything() })
    })

    it('shows the plan file on the feature and the refs on the sub-task', async () => {
      const { feature, sub, token } = await setup()
      await noteTurn(store, 'WS', 'user', 'add a task')
      expect(await cli(token, ['show', feature.id])).toMatchObject({ task: { planFile: 'specs/tasks.md' } })
      expect(await cli(token, ['show', sub.id])).toMatchObject({ task: { refs: ['T010', 'T011'] } })
      await expect(cli(token, ['task', 'add', 'More', '--type', 'task', '--feature', feature.id, '--refs', 'T020', '--project', 'PA'])).resolves.toMatchObject({ task: { refs: ['T020'] } })
      const bare = await store.addTask({ project: 'WS', title: 'No plan', type: 'feature' })
      await expect(cli(token, ['task', 'add', 'More', '--type', 'task', '--feature', bare.id, '--refs', 'T020', '--project', 'PA'])).rejects.toThrow(/has no plan file/)
    })

    it('with no git in the root, ticks the lines in the file and nothing else', async () => {
      const { sub } = await setup()
      await fs.writeFile(path.join(root, 'other.md'), '- [ ] T010 not the plan\n')
      expect(await tick(sub.id)).toBeUndefined()
      // Not done yet: nothing.
      expect(await planText()).toBe(PLAN)
      await finish(sub.id)
      await tick(sub.id)
      const lines = (await planText()).split('\n')
      expect(lines[2]).toMatch(/^- \[x\] T010 \[P\] \[US1\] Add the endpoint \(done: PA-1, \d{4}-\d{2}-\d{2}\)$/)
      expect(lines[3]).toMatch(/^- \[x\] T011 \[US1\] Add the button \(see FR-2\) \(done: PA-1, \d{4}-\d{2}-\d{2}\)$/)
      expect(await fs.readFile(path.join(root, 'other.md'), 'utf8')).toBe('- [ ] T010 not the plan\n')
      const task = (await store.task(sub.id))!
      expect(task.planTick).toMatchObject({ ticked: ['T010', 'T011'] })
      expect(task.log!.at(-1)!.text).toBe(`plan: ticked T010, T011 in specs/tasks.md (written, the root has no git)`)
      // Once only.
      const after = await planText()
      await tick(sub.id)
      expect(await planText()).toBe(after)
    })

    it('says a line already ticked or missing, and ticks the rest', async () => {
      const { sub } = await setup()
      await store.updateTask(sub.id, t => ({ ...t, refs: ['T013', 'T011', 'T099'] }))
      await finish(sub.id)
      await tick(sub.id)
      const text = await planText()
      expect(text).toContain('- [x] T011 [US1] Add the button (see FR-2) (done: PA-1')
      expect(text).toContain('- [x] T013 Already done by hand\n')
      expect((await store.task(sub.id))!.log!.at(-1)!.text).toMatch(/\(written, the root has no git\); plan: T013 not ticked \(already ticked\); plan: T099 not ticked \(not found\)$/)
    })

    it('commits the plan file only, on the root member\'s branch, with the template\'s message, other work untouched', async () => {
      const { sub } = await setup('member', { shared: { commitMessage: '{id}: {title}' } } as Partial<Project>)
      initRepo()
      await fs.writeFile(path.join(root, 'staged.txt'), 'staged\n')
      git(root, 'add', 'staged.txt')
      await fs.writeFile(path.join(root, 'specs/unstaged.md'), 'x\n')
      await store.updateTask(sub.id, t => ({ ...t, refs: ['T010'] }))
      await finish(sub.id)
      await tick(sub.id)
      expect(git(root, 'log', '-1', '--format=%s')).toBe('PA-1: tick T010 (Serve)')
      expect(git(root, 'show', '--name-only', '--format=', 'HEAD')).toBe('specs/tasks.md')
      expect(git(root, 'status', '--porcelain')).toBe('A  staged.txt\n?? specs/unstaged.md')
      expect((await store.task(sub.id))!.log!.at(-1)!.text).toMatch(/^plan: ticked T010 in specs\/tasks.md \(committed [0-9a-f]{7,}\)$/)
    })

    it('without a template, the message names the feature, the lines and the task', async () => {
      const { sub } = await setup()
      initRepo()
      await finish(sub.id)
      await tick(sub.id)
      expect(git(root, 'log', '-1', '--format=%s')).toBe('WS-1: tick T010, T011 (PA-1)')
    })

    it('skips a plan file with local changes, and tells the workspace\'s coordinator', async () => {
      const { sub } = await setup()
      initRepo()
      await store.saveCoordinator({ ...(await store.coordinator('WS'))!, terminal: 't1', autopilot: { ...DEFAULT_AUTOPILOT, on: true } })
      await fs.appendFile(path.join(root, 'specs/tasks.md'), '- [ ] T200 added by the user\n')
      const before = await planText()
      await finish(sub.id)
      await tick(sub.id)
      expect(await planText()).toBe(before)
      expect(git(root, 'log', '--format=%s')).toBe('init')
      const task = (await store.task(sub.id))!
      expect(task.planTick).toEqual({ at: expect.any(Number), skipped: 'specs/tasks.md has local changes' })
      expect(task.log!.at(-1)!.text).toBe('plan: T010, T011 not ticked in specs/tasks.md: specs/tasks.md has local changes')
      const wakes = await store.wakes()
      expect(JSON.stringify(wakes)).toMatch(/PA-1 is done, but its plan lines T010, T011 are not ticked in specs\/tasks.md/)
      const n = wakes.length
      await tick(sub.id)
      expect((await store.wakes()).length).toBe(n)
    })

    it('skips a staged change, an untracked plan file, and a root on another branch than its member\'s base', async () => {
      const staged = await setup()
      initRepo()
      await fs.appendFile(path.join(root, 'specs/tasks.md'), 'more\n')
      git(root, 'add', 'specs/tasks.md')
      await fs.writeFile(path.join(root, 'specs/tasks.md'), PLAN)
      await finish(staged.sub.id)
      await tick(staged.sub.id)
      expect((await store.task(staged.sub.id))!.planTick!.skipped).toBe('specs/tasks.md has local changes')
      await fs.rm(pmDir(), { recursive: true, force: true })

      await fs.rm(path.join(root, '.git'), { recursive: true })
      const untracked = await setup()
      git(root, 'init', '-q', '-b', 'main')
      await finish(untracked.sub.id)
      await tick(untracked.sub.id)
      expect((await store.task(untracked.sub.id))!.planTick!.skipped).toBe('specs/tasks.md is not tracked by git')
      await fs.rm(pmDir(), { recursive: true, force: true })

      await fs.rm(path.join(root, '.git'), { recursive: true })
      const other = await setup('member', { shared: { base: 'main' } } as Partial<Project>)
      initRepo('feature-x')
      await finish(other.sub.id)
      await tick(other.sub.id)
      expect((await store.task(other.sub.id))!.planTick!.skipped).toMatch(/^the root is on branch feature-x \(not main\)$/)
      expect(await planText()).toBe(PLAN)
    })

    it('leaves the file as it was when a hook refuses the commit', async () => {
      const { sub } = await setup()
      initRepo()
      await fs.writeFile(path.join(root, '.git/hooks/pre-commit'), '#!/bin/sh\necho "no commits today" >&2\nexit 1\n', { mode: 0o755 })
      await finish(sub.id)
      await tick(sub.id)
      expect(await planText()).toBe(PLAN)
      expect(git(root, 'status', '--porcelain')).toBe('')
      expect((await store.task(sub.id))!.planTick!.skipped).toMatch(/^git could not commit it: .*no commits today/)
    })

    it('does not tick an abandoned task, one without a plan file, or one not done', async () => {
      const { sub } = await setup()
      await store.updateTask(sub.id, t => ({ ...t, step: { ...doneStep, abandoned: true } }))
      await tick(sub.id)
      expect(await planText()).toBe(PLAN)
      expect((await store.task(sub.id))!.planTick).toBeUndefined()
    })
  })
})

describe('the write script and its answers', () => {
  it('gives the script the root, the file, the branch, the old length and the message, the old and new text on stdin', () => {
    const call = planWriteCall({ path: '/w' }, 'specs/tasks.md', 'main', 'é\n', 'new\n', 'WS-1: tick T1 (PA-1)')
    expect(call.args).toEqual(['/w', 'specs/tasks.md', 'main', '3', 'WS-1: tick T1 (PA-1)'])
    expect(call.input).toBe('é\nnew\n')
    expect(PLAN_WRITE_SCRIPT).toContain('git -C "$r" commit --only -m "$5" -- "$f"')
  })

  it('reads the exit codes: written or committed, again later, or skipped with why', () => {
    expect(planWriteResult(0, 'committed 1a2b3c4', 'p.md', 'main')).toEqual({ done: 'committed 1a2b3c4' })
    expect(planWriteResult(0, 'written', 'p.md', '')).toEqual({ done: 'written, the root has no git' })
    expect(planWriteResult(5, '', 'p.md', '')).toEqual({ again: true })
    expect(planWriteResult(null, '', 'p.md', '')).toEqual({ again: true })
    expect(planWriteResult(6, 'dev', 'p.md', 'main')).toEqual({ skipped: 'the root is on branch dev (not main)' })
    expect(planWriteResult(6, 'no branch', 'p.md', 'main')).toEqual({ skipped: 'the root is on branch no branch (not main)' })
    expect(planWriteResult(7, '', 'p.md', '')).toEqual({ skipped: 'p.md has local changes' })
    expect(planWriteResult(9, 'hook said no', 'p.md', '')).toEqual({ skipped: 'git could not commit it: hook said no' })
    expect(() => planWriteResult(1, '', 'p.md', '')).toThrow(/exit 1/)
  })
})
