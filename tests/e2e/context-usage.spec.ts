import { expect, test } from './test'
import { fakeHerdr, OMP_QUESTIONS_PANE, SPLIT_CHAT_PANE } from './scenario.mjs'

const footer = (pct: number) => [
  `──────────────── ◫ ${pct}%/200K ────────────────`,
  '❯ ',
  '──────────────────────────────────────────────',
  '◒ Test model · 📁 ~/project',
].join('\n')

// Screens, snapshots and UI all use the real server polling path.
test('OMP context retains stale gauges, updates unviewed workers and isolates replacement sessions', { tag: ['@chromium-desktop', '@webkit-phone'] }, async ({ page, request }, info) => {
  const pane = SPLIT_CHAT_PANE
  const original = await fakeHerdr('e2e.pane_field', { pane_id: pane, field: 'session' })
  const interrupts: string[] = []
  page.on('request', r => { if (new URL(r.url()).pathname === '/api/interrupt') interrupts.push(r.url()) })
  const reading = async () => {
    const state = await (await request.get('/api/state')).json()
    return state.panes.find((p: { id: string }) => p.id === pane)?.ompStatus ?? null
  }
  try {
    await fakeHerdr('e2e.interaction_screen', { pane_id: pane, agent: 'omp', status: 'working', text: footer(68) })
    // This OMP is not the selected conversation, but working cards still update.
    await page.goto(`/#/a/${OMP_QUESTIONS_PANE}`)
    await expect.poll(reading).toMatchObject({ metersFresh: true, meters: expect.stringContaining('68%/200K') })
    await page.goto(`/#/a/${pane}`)
    const indicator = page.locator('.composer .omp-context')
    if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) {
      await expect(indicator).toBeHidden()
      expect((await page.locator('.prompt').boundingBox())!.height).toBeLessThanOrEqual(60)
    }
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${info.project.name}-context-rest.png` })
    // Coarse-pointer layouts reveal metadata together with the model picker.
    await page.locator('.prompt').locator('textarea, [contenteditable="true"]').first().focus()
    await expect(indicator).toBeVisible()
    await expect(indicator).toHaveText(/68%.*136K/)
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${info.project.name}-context.png` })
    await indicator.click()
    await expect(page.locator('.omp-context-detail')).toContainText('estimated')
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${info.project.name}-context-details.png` })
    const detail = await page.locator('.omp-context-detail').boundingBox()
    expect(detail).not.toBeNull()
    expect(detail!.x).toBeGreaterThanOrEqual(0)
    expect(detail!.y).toBeGreaterThanOrEqual(0)
    expect(detail!.x + detail!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
    expect(detail!.y + detail!.height).toBeLessThanOrEqual(page.viewportSize()!.height)
    await page.keyboard.press('Escape')
    await expect(page.locator('.omp-context-detail')).toHaveCount(0)
    expect(interrupts).toEqual([])

    // A successful read without gauges must not renew an old reading.
    await fakeHerdr('e2e.interaction_screen', { pane_id: pane, text: 'Full-screen panel' })
    await expect.poll(reading).toMatchObject({ metersFresh: false, meters: expect.stringContaining('68%/200K') })
    await expect(indicator).toHaveAttribute('aria-label', /Last reading; not live/)

    // Compaction may lower usage: no high-water mark or accumulated-token proxy.
    await fakeHerdr('e2e.interaction_screen', { pane_id: pane, text: footer(8) })
    await expect.poll(reading).toMatchObject({ metersFresh: true, meters: expect.stringContaining('8%/200K') })
    await expect(indicator).toHaveText(/8%.*16K/)
    await expect(indicator).not.toHaveAttribute('aria-label', /Last reading/)

    await fakeHerdr('e2e.read_failure', { pane_id: pane, fail: true })
    await expect.poll(reading).toMatchObject({ metersFresh: false, meters: expect.stringContaining('8%/200K') })
    await expect(indicator).toHaveAttribute('aria-label', /Last reading; not live/)
    await fakeHerdr('e2e.read_failure', { pane_id: pane, fail: false })

    // Unviewed resting panes keep their reading without ongoing gauge polls.
    await fakeHerdr('e2e.interaction_screen', { pane_id: pane, status: 'idle', text: footer(8) })
    await page.goto(`/#/a/${OMP_QUESTIONS_PANE}`)
    const reads = async () => (await fakeHerdr('e2e.terminal_screen', { pane_id: pane })).detectionReads
    // Poll the published resting state before measuring subsequent server cycles.
    await expect.poll(async () => {
      const state = await (await request.get('/api/state')).json()
      return state.panes.find((p: { id: string }) => p.id === pane)?.status
    }).toMatch(/idle|done/)
    const count = await reads()
    for (let i = 0; i < 3; i++) {
      await page.waitForResponse(r => new URL(r.url()).pathname === '/api/chat')
      expect(await reads()).toBe(count)
    }
    await expect.poll(reading).toMatchObject({ meters: expect.stringContaining('8%/200K') })
    // A new turn must not present the prior turn's retained gauges as live.
    await fakeHerdr('e2e.interaction_screen', { pane_id: pane, status: 'working', text: footer(32), readDelayMs: 3000 })
    await expect.poll(reading).toMatchObject({ metersFresh: false, meters: expect.stringContaining('8%/200K') })
    await expect.poll(reading).toMatchObject({ metersFresh: true, meters: expect.stringContaining('32%/200K') })

    // A new session cannot inherit the former session's window or percentage.
    await fakeHerdr('e2e.interaction_screen', { pane_id: pane, status: 'working', text: 'Starting new session' })
    await fakeHerdr('e2e.update_session', { pane_id: pane, session: 'replacement-context-session' })
    await expect.poll(reading).toBeNull()
    expect(interrupts).toEqual([])
  } finally {
    await fakeHerdr('e2e.read_failure', { pane_id: pane, fail: false })
    await fakeHerdr('e2e.update_session', { pane_id: pane, session: original.value })
    await fakeHerdr('e2e.interaction_screen', { pane_id: pane, agent: 'omp', status: 'idle', text: null })
  }
})
