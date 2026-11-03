import { expect, test, type FakeCore, type Page } from './fake-core'
import { DECISIONS } from './fake-core-chats'

// The composer on herdr-core: layout (from composer-layout.spec.ts) and attachments (the
// clipboard image of dictation-paste.spec.ts, a file through "+", both written beside the
// terminal with terminal.put and sent with the message). Core has no model or effort
// picker, so the toolbar checks hold the "+" and Send buttons only. Dropped: the paste
// journal of Settings › Advanced and the native-clipboard timing loop (not core-specific).
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
const agent = (core: FakeCore) => core.claude('demo', [['user', 'Are you ready?'], ['assistant', 'Ready when you are.']], { reply: 'Got it.' })
const open = async (page: Page, url: string) => {
  await page.goto(url)
  await expect(page.locator('.chat').getByText('Ready when you are.')).toBeVisible()
}

test('touch composer expands only for editing or a kept draft', async ({ page, core }) => {
  await open(page, agent(core).url)
  const field = page.locator('.prompt textarea')
  const prompt = page.locator('.prompt')
  await expect(prompt).not.toHaveClass(/expanded/)
  await expect(page.locator('.prompt-models')).toHaveCount(0)
  expect((await prompt.boundingBox())!.height).toBeLessThanOrEqual(60)
  await field.focus()
  await expect(prompt).toHaveClass(/expanded/)
  await field.blur()
  await expect(prompt).not.toHaveClass(/expanded/)
  await field.fill('保留草稿时，编辑区仍应占满整行。')
  await field.blur()
  await expect(prompt).toHaveClass(/expanded/)
  await field.fill('')
  await field.blur()
  await expect(prompt).not.toHaveClass(/expanded/)
})

test('blurring an empty touch editor keeps a pressed answer in place', async ({ page, core }) => {
  await page.goto(core.claude('decisions', DECISIONS).url)
  const answer = page.getByRole('button', { name: '1 · Yes: Tag the release today?', exact: true })
  await expect(answer).toBeVisible()
  const field = page.locator('.prompt textarea')
  const prompt = page.locator('.prompt')
  await field.fill('')
  await expect(prompt).toHaveClass(/expanded/)
  await answer.scrollIntoViewIfNeeded()
  const box = (await answer.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  try {
    // Keep the press down across layout frames, as a real finger can: a
    // blur must not collapse the composer and move its target before release.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await expect(prompt).toHaveClass(/expanded/)
    expect((await answer.boundingBox())!.y).toBeCloseTo(box.y, 0)
  } finally { await page.mouse.up() }
  await expect(field).toHaveValue(/Tag the release today\? —\nYes\n$/)
  await expect(page.locator('.composer-ask')).toHaveText('4 questions unanswered')
  await expect(field).not.toBeFocused()
})

test('the editor keeps its width, the toolbar fits, and long drafts scroll above it', async ({ page, core }) => {
  await open(page, agent(core).url)
  const field = page.locator('.prompt textarea')
  const prompt = page.locator('.prompt')
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    await field.fill('请继续研究重连与加载速度，把当前实现中的等待链逐项说明。')
    await expect.poll(async () => (await field.boundingBox())!.width / (await prompt.boundingBox())!.width).toBeGreaterThan(.9)
    const editor = (await field.boundingBox())!
    const footer = (await page.locator('.prompt-foot').boundingBox())!
    expect(footer.y).toBeGreaterThanOrEqual(editor.y + editor.height - 1)
    const controls = page.locator('.prompt-plus, .prompt-send')
    await expect(controls).toHaveCount(2)
    let right = footer.x
    for (const control of await controls.all()) {
      const b = (await control.boundingBox())!
      expect(b.x).toBeGreaterThanOrEqual(right - 1)
      expect(b.x + b.width).toBeLessThanOrEqual(footer.x + footer.width + 1)
      right = b.x + b.width
    }
  }
  await page.setViewportSize({ width: 390, height: 400 })
  const draft = Array.from({ length: 20 }, (_, i) => `第 ${i + 1} 行：请保留完整的中文输入宽度。`).join('\n')
  await field.fill(draft)
  await expect.poll(() => field.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
  expect((await field.boundingBox())!.height).toBeLessThanOrEqual(121)
  await expect(page.locator('.prompt-send')).toBeInViewport()
  await expect(field).toHaveValue(draft)
  await field.fill('')
  await expect.poll(async () => (await field.boundingBox())!.height).toBeLessThanOrEqual(44)
  await expect(page.locator('.prompt-send')).toBeInViewport()
})

test('a pasted image is put beside the terminal and sent with the message', async ({ page, core }) => {
  const claude = agent(core)
  await open(page, claude.url)
  const field = page.locator('.prompt textarea')
  await field.fill('What is on this screenshot?')
  // The same clipboard File path as an iPhone screenshot.
  await field.evaluate((el, png) => {
    const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0))
    const data = new DataTransfer()
    data.items.add(new File([bytes], 'clipboard.png', { type: 'image/png' }))
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, PNG)
  await expect(page.locator('.prompt .attachments img')).toBeVisible()
  await expect(field).toHaveValue('What is on this screenshot?')
  // Written on the terminal's machine (terminal.put): the spinner goes once core gave its path.
  await expect.poll(() => core.puts.length).toBe(1)
  await expect(page.locator('.prompt .attachments .att.up')).toHaveCount(0)
  const put = core.puts[0]!
  expect(put.terminal).toBe(claude.address)
  expect(put.name).toMatch(/\.(png|jpg)$/)
  await page.locator('.prompt-send').click()
  await expect.poll(() => claude.sends.length).toBe(1)
  expect(claude.sends[0]).toContain('What is on this screenshot?')
  expect(claude.sends[0]).toContain(put.name)
  await expect(page.locator('.prompt .attachments img')).toHaveCount(0)
})

test('a file added with "+" is put beside the terminal and its path is sent', async ({ page, core }) => {
  const claude = agent(core)
  await open(page, claude.url)
  await page.getByTestId('attach-any').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('release notes draft\n') })
  await expect.poll(() => core.puts.length).toBe(1)
  const put = core.puts[0]!
  expect(put.data.toString('utf8')).toBe('release notes draft\n')
  await expect(page.getByText('notes.txt')).toBeVisible()
  await page.locator('.prompt textarea').fill('Read this file.')
  await page.locator('.prompt-send').click()
  await expect.poll(() => claude.sends.length).toBe(1)
  expect(claude.sends[0]).toContain('Read this file.')
  expect(claude.sends[0]).toContain(put.name)
  // Settled: the message, then the reply.
  await expect(page.locator('.chat').getByText('Got it.')).toBeVisible()
})

test('a message sent while Claude works waits in its queue, then settles when Claude takes it', async ({ page, core }) => {
  const claude = core.claude('demo', [['user', 'Are you ready?'], ['assistant', 'Ready when you are.'], ['user', 'Update the release notes.']], {
    status: 'working', screen: `✻ Updating… (12s · ↑ 1.2k tokens)\n\n${'─'.repeat(60)}\n❯ \n${'─'.repeat(60)}\n  esc to interrupt`,
  })
  await page.goto(claude.url)
  await expect(page.locator('.chat').getByText('Update the release notes.')).toBeVisible()
  const text = 'Also update the changelog.'
  await page.locator('.prompt textarea').fill(text)
  await page.locator('.prompt-send').click()
  await expect.poll(() => claude.sends).toEqual([text])
  // Claude Code queues a message typed during a turn (its conversation file says so); the
  // bubble stays "Queued" until Claude takes it, then shows once, as a sent message.
  claude.appendLine({ type: 'queue-operation', operation: 'enqueue', timestamp: new Date().toISOString(), content: text })
  const queued = page.locator('.msg-pending.queued', { hasText: text })
  await expect(queued).toBeVisible()
  await expect(page.locator('.msg-user-wrap', { has: queued }).locator('.queued-tag')).toContainText('Queued')
  await expect(page.locator('.msg-user:not(.msg-pending)', { hasText: text })).toHaveCount(0)

  // The turn ends: Claude takes the queued message and answers it.
  claude.append('assistant', 'The release notes are updated.')
  claude.appendLine({ type: 'queue-operation', operation: 'dequeue', timestamp: new Date().toISOString() })
  claude.append('user', text)
  claude.append('assistant', 'The changelog is updated too.')
  claude.setScreen(`${'─'.repeat(60)}\n❯ \n${'─'.repeat(60)}\n  ? for shortcuts`, 'idle')
  await expect(page.locator('.chat').getByText('The changelog is updated too.')).toBeVisible()
  await expect(page.locator('.msg-pending', { hasText: text })).toHaveCount(0)
  await expect(page.locator('.msg-user:not(.msg-pending)', { hasText: text })).toHaveCount(1)
})
