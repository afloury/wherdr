// mini-board example plugin: the .wherdr/tasks.json parser and the coordinator template.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { addTask, nextId, parseTasks, serializeTasks, tasksPath } from '../examples/plugins/mini-board/src/tasks'
import { renderCoordinator } from '../examples/plugins/mini-board/src/coordinator'

const template = readFileSync(resolve(__dirname, '../examples/plugins/mini-board/src/coordinator.md'), 'utf8')

describe('parseTasks', () => {
  it('reads no file or an empty one as an empty board', () => {
    for (const t of [null, '', '  \n']) expect(parseTasks(t)).toEqual({ ok: true, file: { version: 1, maxWorkers: 2, tasks: [] }, warnings: [] })
  })
  it('reads a full file', () => {
    const r = parseTasks(JSON.stringify({ version: 1, maxWorkers: 3, tasks: [
      { id: 't1', title: 'Add a README line', description: 'One line', status: 'working', terminal: 't7', branch: 'wherdr/t1', notes: 'Started.' },
    ] }))
    expect(r).toEqual({ ok: true, warnings: [], file: { version: 1, maxWorkers: 3, tasks: [
      { id: 't1', title: 'Add a README line', description: 'One line', status: 'working', terminal: 't7', branch: 'wherdr/t1', notes: 'Started.' },
    ] } })
  })
  it('fixes what an agent may get slightly wrong, with a warning each', () => {
    const r = parseTasks(JSON.stringify({ maxWorkers: 99, tasks: [
      { id: 1, title: 'numeric id', status: 'DONE' },
      { id: 't2', status: 'in progress', terminal: '', branch: 5 },
      { id: 't2', title: 'dup' },
      { title: 'no id' },
      'nope',
    ] }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.file.maxWorkers).toBe(2)
    expect(r.file.tasks.map(t => [t.id, t.title, t.status, t.terminal, t.branch])).toEqual([['1', 'numeric id', 'done', null, null], ['t2', 't2', 'todo', null, null]])
    expect(r.warnings).toHaveLength(5)
  })
  it('accepts a bare array; refuses invalid JSON and other shapes (the board then never writes)', () => {
    expect(parseTasks('[{"id":"t1","title":"x"}]')).toMatchObject({ ok: true, file: { tasks: [{ id: 't1', status: 'todo' }] } })
    expect(parseTasks('{"tasks": [')).toMatchObject({ ok: false, error: expect.stringMatching(/Invalid JSON/) })
    expect(parseTasks('{"items": []}')).toMatchObject({ ok: false })
    expect(parseTasks('42')).toMatchObject({ ok: false })
  })
  it('round-trips through serializeTasks', () => {
    const f = addTask(addTask(parseTasks(null).ok ? (parseTasks(null) as any).file : null, 'First'), ' Second ', ' details ')
    const again = parseTasks(serializeTasks(f))
    expect(again).toEqual({ ok: true, file: f, warnings: [] })
    expect(f.tasks.map(t => [t.id, t.title, t.description, t.status])).toEqual([['t1', 'First', '', 'todo'], ['t2', 'Second', 'details', 'todo']])
  })
})

describe('ids, paths, addTask', () => {
  it('numbers after the highest tN', () => {
    expect(nextId([])).toBe('t1')
    expect(nextId([{ id: 't3' }, { id: 'custom' }, { id: 't10' }])).toBe('t11')
  })
  it('needs a title', () => expect(() => addTask({ version: 1, maxWorkers: 2, tasks: [] }, '  ')).toThrow())
  it('puts the file in .wherdr of the project', () => expect(tasksPath('/home/u/app/')).toBe('/home/u/app/.wherdr/tasks.json'))
})

describe('coordinator template', () => {
  const text = renderCoordinator(template, { project: '/home/u/app', tasksFile: '/home/u/app/.wherdr/tasks.json', maxWorkers: 2 })
  it('fills every placeholder', () => {
    expect(text).not.toMatch(/\{\{/)
    expect(text).toContain('/home/u/app/.wherdr/tasks.json')
    expect(text).toContain('"maxWorkers": 2')
  })
  it('asks for worktrees, labelled background workers, hc wait, and no merge', () => {
    expect(text).toContain('git worktree add .wherdr/worktrees/<id> -b wherdr/<id>')
    expect(text).toMatch(/hc run --bg .*--label wherdr\.task=<id> --label wherdr\.project=\/home\/u\/app/s)
    expect(text).toContain('hc label <t> wherdr.task=<id>')
    expect(text).toContain('hc wait --children any')
    expect(text).toContain('hc read')
    expect(text).toMatch(/Never merge/)
    expect(text.length).toBeLessThan(64 * 1024) // the first-message limit
  })
})
