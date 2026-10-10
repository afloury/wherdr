import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { CODEX_UPDATE_PANE, CODEX_UPDATE_SESSION, SOCK_FILE, fakeHerdr } from './scenario.mjs'

const card = (page: Page) => page.locator('.choices')
const record = () => {
  try {
    const records = JSON.parse(fs.readFileSync(path.join(path.dirname(SOCK_FILE), 'data/last-agents.json'), 'utf8'))
    return records.find(([id]: [string]) => id === CODEX_UPDATE_PANE)?.[1]
  } catch { return null }
}
const transcriptFile = (session = CODEX_UPDATE_SESSION) => path.join(path.dirname(fs.readFileSync(SOCK_FILE, 'utf8')),
  `home/.codex/sessions/${new Date().toISOString().slice(0, 10).replaceAll('-', '/')}/rollout-test-${session}.jsonl`)
const stats = () => fakeHerdr('e2e.update_starts', { pane_id: CODEX_UPDATE_PANE })
const post = (page: Page, endpoint: string, data: object) => page.request.post(`/api/${endpoint}`, {
  headers: { Origin: new URL(page.url()).origin }, data: { pane_id: CODEX_UPDATE_PANE, ...data },
})
async function stopAfterUpdate(page: Page, existing = false, question = 'Codex updated itself and stopped') {
  const { pid } = await fakeHerdr('e2e.update_reset', { pane_id: CODEX_UPDATE_PANE, ...(existing ? { session: CODEX_UPDATE_SESSION } : {}) })
  await page.goto(`/#/a/${CODEX_UPDATE_PANE}`)
  // Wait for wherdr to capture this invocation's argv and conversation.
  await expect.poll(record, { timeout: 15000 }).toMatchObject({ pid, conversation: existing ? 'existing' : 'empty', ...(existing ? { session: CODEX_UPDATE_SESSION } : {}) })
  if (existing) await expect(page.locator('.chat').getByText('The build passes.')).toBeVisible()
  await fakeHerdr('e2e.update_exit', { pane_id: CODEX_UPDATE_PANE })
  await expect(card(page).getByText(question)).toBeVisible()
}

test('a new Codex restarts with its original options, only after a tap', async ({ page }, info) => {
  await stopAfterUpdate(page)
  const button = card(page).getByRole('button', { name: 'Restart Codex', exact: false })
  await expect(button).toBeVisible()
  await expect(page.locator('.prompt textarea')).toBeDisabled()
  expect((await fakeHerdr('e2e.update_starts', { pane_id: CODEX_UPDATE_PANE })).starts).toEqual([])
  if (info.project.name.startsWith('chromium')) {
    await page.screenshot({ path: `.shots/codex-update-${info.project.name}.png`, fullPage: true })
  }
  expect((await (await post(page, 'prompt', { text: 'Held until startup returns' })).json()).queued.state).toBe('held')
  expect((await stats()).prompts).toEqual([])
  await button.click()
  await expect.poll(async () => (await fakeHerdr('e2e.update_starts', { pane_id: CODEX_UPDATE_PANE })).starts.length).toBe(1)
  const { starts } = await fakeHerdr('e2e.update_starts', { pane_id: CODEX_UPDATE_PANE })
  expect(starts[0]).toMatchObject({ kind: 'codex', pane_id: CODEX_UPDATE_PANE, args: ['--profile', 'work', '-m', 'gpt-x'] })
  await expect(card(page)).toHaveCount(0)
  await expect.poll(async () => (await stats()).prompts.map((p: { text: string }) => p.text)).toEqual(['Held until startup returns'])
})

const leaving = async (page: Page) => {
  const state = await (await page.request.get('/api/state')).json()
  return Boolean(state.panes.find((p: { id: string }) => p.id === CODEX_UPDATE_PANE)?.leaving)
}

test('a Project message sent before the card appears is held, never typed into the shell', async ({ page }) => {
  const { pid } = await fakeHerdr('e2e.update_reset', { pane_id: CODEX_UPDATE_PANE })
  await page.goto(`/#/a/${CODEX_UPDATE_PANE}`)
  await expect.poll(record, { timeout: 15000 }).toMatchObject({ pid, conversation: 'empty' })
  await fakeHerdr('e2e.update_exit', { pane_id: CODEX_UPDATE_PANE })
  // Codex is gone and its screen is not checked yet: a bare shell, no card.
  await expect.poll(() => leaving(page), { intervals: [50] }).toBe(true)
  await expect(card(page)).toHaveCount(0)
  // What the Project panel sends to a pane with no agent: text, then Enter.
  const raw = await post(page, 'input', { text: 'Confirm: Check the restart', keys: ['enter'] })
  expect((await raw.json()).queued.state).toBe('held')
  expect((await post(page, 'input', { keys: ['enter'] })).status()).toBe(400)
  expect(await stats()).toMatchObject({ starts: [], writes: [], prompts: [] })
  const button = card(page).getByRole('button', { name: 'Restart Codex', exact: false })
  await expect(button).toBeVisible()
  expect(await leaving(page)).toBe(false)
  expect(await stats()).toMatchObject({ writes: [], prompts: [] })
  await button.click()
  await expect.poll(async () => (await stats()).prompts.map((p: { text: string }) => p.text)).toEqual(['Confirm: Check the restart'])
  expect((await stats()).writes).toEqual([])
})

test('Dismiss forgets the update and gives the pane back as a plain shell', async ({ page }, info) => {
  const pane = async () => (await (await page.request.get('/api/state')).json()).panes.find((p: { id: string }) => p.id === CODEX_UPDATE_PANE)
  await stopAfterUpdate(page)
  const held = (await (await post(page, 'prompt', { text: 'Held for the restart' })).json()).queued
  expect(held.state).toBe('held')
  await card(page).getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect(card(page)).toHaveCount(0)
  await expect.poll(record).toBeUndefined()
  // No agent, no question, no disabled field: a shell like any other.
  expect(await pane()).toMatchObject({ agent: null, queued: expect.arrayContaining([expect.objectContaining({ text: 'Held for the restart', state: 'failed' })]) })
  expect((await pane()).stopped).toBeUndefined()
  expect((await pane()).prompt).toBeUndefined()
  expect(await stats()).toMatchObject({ starts: [], writes: [], prompts: [] })
  if (info.project.name.startsWith('chromium')) await page.screenshot({ path: `.shots/codex-update-dismissed-${info.project.name}.png`, fullPage: true })
  // The card does not come back on later polls, nor after a reload.
  await page.reload()
  await page.waitForTimeout(2500)
  await expect(card(page)).toHaveCount(0)
  expect((await post(page, 'unqueue', held)).status()).toBe(200)
  expect(await stats()).toMatchObject({ starts: [], writes: [], prompts: [] })
})

test('an existing Codex resumes its exact session', async ({ page }) => {
  await stopAfterUpdate(page, true)
  await expect(card(page).getByRole('button', { name: /Start fresh/ })).toBeVisible()
  expect((await (await post(page, 'prompt', { text: 'Held until exact resume' })).json()).queued.state).toBe('held')
  await card(page).getByRole('button', { name: /Resume conversation/ }).click()
  await expect.poll(async () => (await fakeHerdr('e2e.update_starts', { pane_id: CODEX_UPDATE_PANE })).starts.length).toBe(1)
  const { starts } = await fakeHerdr('e2e.update_starts', { pane_id: CODEX_UPDATE_PANE })
  expect(starts[0].args).toEqual(['resume', '--profile', 'work', '-m', 'gpt-x', CODEX_UPDATE_SESSION])
  await expect.poll(async () => (await stats()).prompts.map((p: { text: string }) => p.text)).toEqual(['Held until exact resume'])
})

test('an existing conversation can explicitly start fresh', async ({ page }) => {
  await stopAfterUpdate(page, true)
  expect((await (await post(page, 'prompt', { text: 'Held until fresh start' })).json()).queued.state).toBe('held')
  await card(page).getByRole('button', { name: /Start fresh/ }).click()
  await expect.poll(async () => (await fakeHerdr('e2e.update_starts', { pane_id: CODEX_UPDATE_PANE })).starts.length).toBe(1)
  const { starts } = await fakeHerdr('e2e.update_starts', { pane_id: CODEX_UPDATE_PANE })
  expect(starts[0].args).toEqual(['--profile', 'work', '-m', 'gpt-x'])
  await expect.poll(async () => (await stats()).prompts.map((p: { text: string }) => p.text)).toEqual(['Held until fresh start'])
})

test('the restart card and both conversation choices are translated into French', async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem('herdrLanguage', 'fr'))
  await stopAfterUpdate(page, true, 'Codex s’est mis à jour et s’est arrêté')
  await expect(card(page).getByRole('button', { name: /Reprendre la conversation/ })).toBeVisible()
  await expect(card(page).getByRole('button', { name: /Démarrer une nouvelle conversation/ })).toBeVisible()
  await expect(card(page).getByRole('button', { name: 'Ignorer', exact: true })).toBeVisible()
  if (info.project.name.startsWith('chromium')) await page.screenshot({ path: `.shots/codex-update-fr-${info.project.name}.png`, fullPage: true })
})

test('a shell draft refuses restart and keyboard navigation sends nothing', async ({ page }) => {
  await stopAfterUpdate(page)
  await fakeHerdr('e2e.update_draft', { pane_id: CODEX_UPDATE_PANE, text: 'echo hello' })
  const response = page.waitForResponse(r => r.url().endsWith('/api/choose'))
  await card(page).getByRole('button', { name: /Restart Codex/ }).click()
  expect((await response).status()).toBe(400)
  expect((await fakeHerdr('e2e.update_starts', { pane_id: CODEX_UPDATE_PANE })).starts).toEqual([])
  const nav = await page.request.post('/api/nav', { headers: { Origin: new URL(page.url()).origin }, data: { pane_id: CODEX_UPDATE_PANE, key: 'enter' } })
  expect(nav.status()).toBe(400)
})

test('another foreground program refuses restart', async ({ page }) => {
  await stopAfterUpdate(page)
  await fakeHerdr('e2e.update_foreground', { pane_id: CODEX_UPDATE_PANE })
  const response = page.waitForResponse(r => r.url().endsWith('/api/choose'))
  await card(page).getByRole('button', { name: /Restart Codex/ }).click()
  expect((await response).status()).toBe(400)
  expect((await fakeHerdr('e2e.update_starts', { pane_id: CODEX_UPDATE_PANE })).starts).toEqual([])
})

for (const draft of ["echo '\n> ", 'cat <<EOF\n> ']) {
  test(`a continuation draft present before the first exit check never allows a restart: ${draft.split('\n')[0]}`, async ({ page }) => {
    await stopAfterUpdate(page)
    // Re-arm a new invocation, then atomically exit with a pre-existing draft.
    const { pid } = await fakeHerdr('e2e.update_reset', { pane_id: CODEX_UPDATE_PANE })
    await expect.poll(record, { timeout: 15000 }).toMatchObject({ pid, conversation: 'empty' })
    await fakeHerdr('e2e.update_exit', { pane_id: CODEX_UPDATE_PANE, draft })
    await expect.poll(record, { timeout: 15000 }).toMatchObject({ pid, checked: true })
    expect(record().signature).toBeUndefined()
    await expect(card(page)).toHaveCount(0)
    const r = await post(page, 'choose', { index: 0, label: 'Restart Codex' })
    expect(r.status()).toBe(400)
    expect(await stats()).toMatchObject({ starts: [], writes: [], prompts: [] })
  })
}

test('a rapidly replaced process keeps its own arguments through the restart API', async ({ page }) => {
  await stopAfterUpdate(page)
  const first = await fakeHerdr('e2e.update_reset', { pane_id: CODEX_UPDATE_PANE })
  await expect.poll(record, { timeout: 15000 }).toMatchObject({ pid: first.pid, conversation: 'empty' })
  const second = await fakeHerdr('e2e.update_replace', { pane_id: CODEX_UPDATE_PANE, argv: ['codex', '--profile', 'second', 'second task'] })
  await expect.poll(record, { timeout: 15000 }).toMatchObject({ pid: second.pid, argv: ['codex', '--profile', 'second', 'second task'] })
  await fakeHerdr('e2e.update_exit', { pane_id: CODEX_UPDATE_PANE })
  await expect(card(page).getByRole('button', { name: /Restart Codex/ })).toBeVisible()
  await card(page).getByRole('button', { name: /Restart Codex/ }).click()
  await expect.poll(async () => (await stats()).starts).toMatchObject([{ args: ['--profile', 'second', 'second task'] }])
})

test('an empty transcript followed by a failed final read offers Resume with the exact ID', async ({ page }) => {
  const file = transcriptFile()
  const original = fs.readFileSync(file, 'utf8')
  try {
    fs.writeFileSync(file, original.split('\n')[0] + '\n')
    const { pid } = await fakeHerdr('e2e.update_reset', { pane_id: CODEX_UPDATE_PANE, session: CODEX_UPDATE_SESSION })
    await page.goto(`/#/a/${CODEX_UPDATE_PANE}`)
    await expect.poll(record, { timeout: 15000 }).toMatchObject({ pid, conversation: 'empty', session: CODEX_UPDATE_SESSION })
    // First messages arrive, but the final re-read cannot read the transcript.
    fs.writeFileSync(file, original)
    fs.chmodSync(file, 0)
    await fakeHerdr('e2e.update_exit', { pane_id: CODEX_UPDATE_PANE })
    await expect(card(page).getByRole('button', { name: /Resume conversation/ })).toBeVisible()
    expect(record().conversation).toBe('unknown')
    await expect(card(page).getByRole('button', { name: /Start fresh/ })).toBeVisible()
    fs.chmodSync(file, 0o600)
    await card(page).getByRole('button', { name: /Resume conversation/ }).click()
    await expect.poll(async () => (await stats()).starts).toMatchObject([{ args: ['resume', '--profile', 'work', '-m', 'gpt-x', CODEX_UPDATE_SESSION] }])
  } finally { fs.chmodSync(file, 0o600); fs.writeFileSync(file, original) }
})

test('guessed B invalidates exact A before a final read failure and Resume opens the picker', async ({ page }) => {
  await stopAfterUpdate(page, true)
  const { pid } = await fakeHerdr('e2e.update_reset', { pane_id: CODEX_UPDATE_PANE, session: CODEX_UPDATE_SESSION })
  await expect.poll(record, { timeout: 15000 }).toMatchObject({ pid, session: CODEX_UPDATE_SESSION, conversation: 'existing' })
  const sessionB = `00000000-0000-4000-8000-${String(pid).padStart(12, '0')}`
  const file = transcriptFile(sessionB)
  const meta = JSON.parse(fs.readFileSync(transcriptFile(), 'utf8').split('\n')[0]!)
  meta.payload.id = sessionB; meta.payload.timestamp = new Date().toISOString()
  fs.writeFileSync(file, [meta, { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Conversation B is current.' }] } }].map(x => JSON.stringify(x)).join('\n') + '\n')
  try {
    await fakeHerdr('e2e.update_session', { pane_id: CODEX_UPDATE_PANE, session: null })
    await expect(page.locator('.chat').getByText('Conversation B is current.')).toBeVisible()
    await expect.poll(record, { timeout: 15000 }).toMatchObject({ pid, session: null, conversation: 'existing' })
    fs.chmodSync(file, 0)
    await fakeHerdr('e2e.update_exit', { pane_id: CODEX_UPDATE_PANE })
    await expect(card(page).getByRole('button', { name: /Resume conversation/ })).toBeVisible()
    expect(record().session).toBeNull()
    fs.chmodSync(file, 0o600)
    await card(page).getByRole('button', { name: /Resume conversation/ }).click()
    await expect.poll(async () => (await stats()).starts).toMatchObject([{ args: ['resume', '--profile', 'work', '-m', 'gpt-x'] }])
  } finally { fs.chmodSync(file, 0o600); fs.unlinkSync(file) }
})

for (const occupied of ['draft', 'foreground']) {
  test(`Project panel confirmation and launch stay queued with a shell ${occupied}`, async ({ page }) => {
    await stopAfterUpdate(page, true)
    if (occupied === 'draft') await fakeHerdr('e2e.update_draft', { pane_id: CODEX_UPDATE_PANE, text: 'echo hello' })
    else await fakeHerdr('e2e.update_foreground', { pane_id: CODEX_UPDATE_PANE })
    const board = { slug: 'acme', version: 'v1', lists: [
      { title: 'To test', kind: 'test', tasks: [{ text: 'Check the restart', done: false, owner: 'agent', thread: null }] },
      { title: 'Backlog', kind: 'backlog', tasks: [{ text: 'Continue the task', done: false, owner: 'agent', thread: null }] },
    ], open: [], resolved: [] }
    await page.route('**/api/project?**', route => route.fulfill({ json: board }))
    await page.evaluate(pane => localStorage.setItem('viewModes', JSON.stringify({ [pane]: 'project' })), CODEX_UPDATE_PANE)
    await page.reload()
    const held: { id: string, text: string }[] = []
    for (const label of ['Confirm: Check the restart', 'Launch: Continue the task']) {
      const response = page.waitForResponse(r => r.url().endsWith('/api/prompt') && r.request().method() === 'POST')
      await page.getByRole('button', { name: label, exact: true }).click()
      const r = await response
      expect(r.status()).toBe(200)
      const queued = (await r.json()).queued
      expect(queued.state).toBe('held')
      held.push(queued)
    }
    // A stale client bypassing sendMessage is guarded by the real raw endpoint too.
    const raw = await post(page, 'input', { text: 'Send to coordinator', keys: ['enter'] })
    const queued = (await raw.json()).queued
    expect(queued.state).toBe('held')
    held.push(queued)
    expect((await post(page, 'input', { keys: ['enter'] })).status()).toBe(400)
    expect((await post(page, 'prompt', { text: '/exit' })).status()).toBe(400)
    expect(await stats()).toMatchObject({ starts: [], writes: [], prompts: [] })
    // Leave no held Project messages for the next browser profile's restart.
    for (const message of held) expect((await post(page, 'unqueue', message)).status()).toBe(200)
    expect(await stats()).toMatchObject({ starts: [], writes: [], prompts: [] })
  })
}
