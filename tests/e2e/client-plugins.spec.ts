import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pdfAuthDb, pdfSession } from './pdfAuth.mjs'

// Own isolated server (like core-connection.spec.ts), with a plugins folder.
async function start(plugins: Record<string, { manifest: object, code: string }>) {
  const data = await mkdtemp(join(tmpdir(), 'plugins-e2e-'))
  await writeFile(join(data, 'auth.json'), JSON.stringify(pdfAuthDb))
  await writeFile(join(data, 'push.json'), '{"subs":[]}')
  for (const [id, p] of Object.entries(plugins)) {
    await mkdir(join(data, 'plugins', id), { recursive: true })
    await writeFile(join(data, 'plugins', id, 'manifest.json'), JSON.stringify(p.manifest))
    await writeFile(join(data, 'plugins', id, 'index.js'), p.code)
  }
  const probe = createServer()
  let port = 7690
  for (; port <= 7699; port++) {
    if (await new Promise<boolean>(r => { probe.once('error', () => r(false)); probe.listen(port, '127.0.0.1', () => r(true)) })) break
  }
  if (port > 7699) throw new Error('No free isolated test port')
  await new Promise<void>(r => probe.close(() => r()))
  const server = spawn(process.execPath, ['.output/server/index.mjs'], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: data, WHERDR_BACKEND: 'core', NUXT_PUBLIC_CORE: 'true', HC_SOCKET: join(data, 'none.sock'), HERDR_WEB_MACHINES: 'off' }, stdio: 'ignore',
  })
  const url = `http://localhost:${port}`
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${url}/api/health`)).ok) break } catch { /* not up yet */ } await new Promise(r => setTimeout(r, 100)) }
  return { url, stop: async () => { server.kill('SIGTERM'); await rm(data, { recursive: true, force: true }) } }
}

test('a working plugin runs, a broken one is disabled with its message, the app keeps working', async ({ page }) => {
  const s = await start({
    good: { manifest: { name: 'Good plugin' }, code: 'export default (w) => { document.body.dataset.goodPlugin = String(w.apiVersion) }' },
    bad: { manifest: { name: 'Bad plugin' }, code: 'export default () => { throw new Error("broken on purpose") }' },
  })
  try {
    await page.context().addCookies([{ name: 'hw_session', value: pdfSession(), url: s.url }])
    await page.goto(`${s.url}/#/settings?section=plugins`)
    await expect(page.locator('[data-wherdr="settings"]')).toBeVisible()
    await expect(page.locator('[data-plugin="bad"] [role="alert"]')).toHaveText('broken on purpose')
    await expect(page.locator('[data-plugin="bad"]')).toContainText('Disabled after an error')
    await expect(page.locator('[data-plugin="good"]')).toContainText('On')
    await expect(page.locator('body')).toHaveAttribute('data-good-plugin', '1')
    // Switching the good one off keeps the choice after a reload.
    await page.locator('[data-plugin="good"] button[role="switch"]').click()
    await page.reload()
    await expect(page.locator('[data-plugin="good"]')).toContainText('Off')
    await expect(page.locator('body')).not.toHaveAttribute('data-good-plugin', /.*/)
  } finally { await s.stop() }
})

test('an empty plugins folder changes nothing', async ({ page }) => {
  const s = await start({})
  try {
    await page.context().addCookies([{ name: 'hw_session', value: pdfSession(), url: s.url }])
    await page.goto(`${s.url}/#/settings?section=plugins`)
    await expect(page.locator('[data-wherdr="settings-plugins"]')).toContainText('No plugin installed')
  } finally { await s.stop() }
})
