import { test, expect, type Page } from '@playwright/test'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pdfAuthDb, pdfSession } from './pdfAuth.mjs'
import fixture from '../fixtures/core-0.1.16.json' with { type: 'json' }

// mini-board example plugin (experimental) on herdr-core: installed in DATA_DIR/plugins, a task
// added from the Board lands in .wherdr/tasks.json, Start coordinator runs a (fake) Claude with
// the coordinator's labels and instructions, and a worker it "spawns" shows on the task.
// Own isolated server and fake core; machine.exec runs for real in a temporary home.
test('mini-board: add a task, start the coordinator, follow its worker', async ({ page, browser }) => {
  const data = await mkdtemp(join(tmpdir(), 'core-mini-board-'))
  const home = await realpath(await mkdtemp(join(tmpdir(), 'core-mini-board-home-')))
  const project = join(home, 'app')
  const socketPath = join(data, 'core.sock')
  await writeFile(join(data, 'auth.json'), JSON.stringify(pdfAuthDb))
  await writeFile(join(data, 'push.json'), '{"subs":[]}')
  await mkdir(join(data, 'plugins/mini-board'), { recursive: true })
  for (const f of ['manifest.json', 'index.js']) await copyFile(join('examples/plugins/mini-board', f), join(data, 'plugins/mini-board', f))
  await mkdir(join(project, '.git'), { recursive: true })
  await mkdir(join(home, '.local/bin'), { recursive: true })
  await writeFile(join(home, '.local/bin/claude'), '#!/bin/sh\n')
  await chmod(join(home, '.local/bin/claude'), 0o755)

  const probe = createServer()
  let port = 7690
  for (; port <= 7699; port++) {
    if (await new Promise<boolean>(resolve => { probe.once('error', () => resolve(false)); probe.listen(port, '127.0.0.1', () => resolve(true)) })) break
  }
  if (port > 7699) throw new Error('No free isolated test port')
  await new Promise<void>(resolve => probe.close(() => resolve()))
  const server = spawn(process.execPath, ['.output/server/index.mjs'], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: data,
      WHERDR_BACKEND: 'core', NUXT_PUBLIC_CORE: 'true', HC_SOCKET: socketPath, HERDR_WEB_MACHINES: 'off' }, stdio: 'ignore',
  })

  // The fake core: one agent in the project; terminal.run adds terminals; machine.exec is real sh.
  type T = { address: string, name: string, cwd: string, state: string, agent: string, labels: Record<string, string>, argv: string[], created_ms: number, status: { state: string } }
  const terminals: T[] = [{ address: 't1', name: 'claude', cwd: project, state: 'live', agent: 'claude', labels: {}, argv: ['claude'], created_ms: 0, status: { state: 'idle' } }]
  const runs: any[] = []
  const sends: { terminal: string, text: string }[] = []
  const core = createServer(socket => socket.once('data', (chunk) => {
    const r = JSON.parse(chunk.toString().split('\n')[0]!)
    const p = r.params ?? {}
    let result: unknown = fixture.discover
    if (r.method === 'hello') result = fixture.hello
    else if (r.method === 'terminal.list') result = { terminals, machines: [], hidden_finished: 0 }
    else if (r.method === 'machine.list') result = { machines: [] }
    else if (r.method === 'machine.exec') {
      const x = spawnSync(p.argv[0], p.argv.slice(1), { env: { PATH: process.env.PATH, HOME: home }, input: p.input ? Buffer.from(p.input, 'base64') : '' })
      result = { code: x.status, stdout: x.stdout.toString('base64'), stderr: x.stderr.toString('base64') }
    } else if (r.method === 'terminal.run') {
      runs.push(p)
      const address = `t${terminals.length + 1}`
      terminals.push({ address, name: p.name || 'claude', cwd: p.cwd, state: 'live', agent: 'claude', labels: p.labels || {}, argv: ['claude'], created_ms: Date.now(), status: { state: 'idle' } })
      result = { address }
    } else if (r.method === 'terminal.get') result = { ...terminals.find(t => t.address === p.terminal), state: 'live' }
    else if (r.method === 'terminal.read') result = { text: '> ' }
    else if (r.method === 'terminal.send') { sends.push(p); result = { sent: true } }
    socket.end(JSON.stringify({ jsonrpc: '2.0', id: r.id, result }) + '\n')
  }))

  const openBoard = async (pg: Page) => {
    await pg.goto(`http://localhost:${port}/`)
    await pg.locator('[data-mini-board="entry"]').click()
    await pg.locator(`[data-project="${project}"]`).click()
  }
  try {
    await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${port}/api/health`)).ok } catch { return false } }).toBe(true)
    await page.context().addCookies([{ name: 'hw_session', value: pdfSession(), url: `http://localhost:${port}` }])
    await new Promise<void>(resolve => core.listen(socketPath, resolve))

    // The plugin is on, and its Board entry counts the project.
    await page.goto(`http://localhost:${port}/`)
    await expect(page.locator('[data-mini-board="entry"]')).toContainText('1 project')
    await openBoard(page)
    await expect(page.locator('[data-mini-board="panel"]')).toContainText('No task yet.')

    // Add task: written to the project's file.
    await page.getByLabel('Task title').fill('Add a README line')
    await page.getByLabel('Task description').fill('One line saying what the project is.')
    await page.getByRole('button', { name: 'Add task' }).click()
    await expect(page.locator('[data-task="t1"]')).toContainText('Add a README line')
    const file = JSON.parse(await readFile(join(project, '.wherdr/tasks.json'), 'utf8'))
    expect(file).toMatchObject({ version: 1, maxWorkers: 2, tasks: [{ id: 't1', title: 'Add a README line', status: 'todo' }] })

    // Start coordinator: a Claude in the project, with its labels and the instructions as first message.
    await page.getByRole('button', { name: 'Start coordinator' }).click()
    await expect.poll(() => runs.length).toBe(1)
    expect(runs[0]).toMatchObject({ cwd: project, name: 'coord-app', labels: { 'wherdr.role': 'coordinator', 'wherdr.project': project } })
    await expect.poll(() => sends.find(s => s.terminal === 't2')?.text ?? '', { timeout: 15_000 }).toContain(`${project}/.wherdr/tasks.json`)
    expect(sends[0]!.text).toContain('hc run --bg')
    await expect(page).toHaveURL(/#\/a\//)

    // The (fake) coordinator does its job: a worktree worker labelled for t1, and the file updated.
    terminals.push({ address: 't3', name: 'wherdr-t1', cwd: join(project, '.wherdr/worktrees/t1'), state: 'live', agent: 'claude',
      labels: { 'wherdr.task': 't1', 'wherdr.project': project }, argv: ['claude'], created_ms: Date.now(), status: { state: 'working' } })
    file.tasks[0] = { ...file.tasks[0], status: 'working', terminal: 't3', branch: 'wherdr/t1', notes: 'Started.' }
    await writeFile(join(project, '.wherdr/tasks.json'), JSON.stringify(file, null, 2))

    await openBoard(page)
    await expect(page.locator('[data-mini-board="open-coordinator"]')).toBeVisible()
    const task = page.locator('[data-task="t1"]')
    await expect(task).toContainText('wherdr/t1')
    await expect(task).toContainText('Worker working')
    await mkdir('.shots', { recursive: true })
    await page.screenshot({ path: '.shots/mini-board-phone.png' })
    // The worker's worktree is not offered as a project of its own.
    await page.getByRole('button', { name: 'Projects' }).click()
    await expect(page.locator('[data-project]')).toHaveCount(1)
    await page.locator(`[data-project="${project}"]`).click()
    await page.locator('[data-task="t1"]').click()
    await expect(page).toHaveURL(/#\/a\//)
    await expect(page.locator('[data-mini-board="panel"]')).toHaveCount(0)

    // Desktop: the same Board as a side panel.
    const desk = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await desk.addCookies([{ name: 'hw_session', value: pdfSession(), url: `http://localhost:${port}` }])
    const deskPage = await desk.newPage()
    await openBoard(deskPage)
    await expect(deskPage.locator('[data-task="t1"]')).toContainText('Worker working')
    await deskPage.screenshot({ path: '.shots/mini-board-desktop.png' })
    await desk.close()
  } finally {
    if (server.exitCode === null) { server.kill('SIGTERM'); await new Promise<void>(resolve => server.once('exit', () => resolve())) }
    if (core.listening) await new Promise<void>(resolve => core.close(() => resolve()))
    await rm(data, { recursive: true, force: true })
    await rm(home, { recursive: true, force: true })
  }
})
