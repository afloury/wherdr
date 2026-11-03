import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { fixture, startCore } from './core'

// Settings > Machines on herdr-core: core line, rename, forget (own isolated server and fake core).
test('machines can be renamed and forgotten, and the core line shows', async ({ page }) => {
  const machineList = [{ name: 'host-a', state: 'connected' }, { name: 'host-b', state: 'unreachable', why: 'a different core answers there' }]
  const core = await startCore((r) => {
    if (r.method === 'machine.rename') machineList.find(m => m.name === r.params.machine)!.name = r.params.new_name
    if (r.method === 'machine.rm') machineList.splice(machineList.findIndex(m => m.name === r.params.machine), 1)
    return r.method === 'terminal.list' ? { ...fixture.inventory, terminals: [] }
      : r.method === 'machine.list' ? { machines: machineList }
      : r.method === 'server.status' ? { core: { id: 'x', name: 'core-a' }, version: '0.1.17', pid: 1, uptime_ms: 3 * 3600 * 1000, holders: [], live: 0, finished: 0 }
      : r.method === 'machine.add' ? { name: 'box' }
      : r.method === 'machine.rename' || r.method === 'machine.rm' ? { removed: r.params.machine } : undefined
  })
  const rpc = core.calls
  try {
    await core.open(page, '/#/settings?section=agents')
    await expect(page.getByTestId('core-machine').first()).toContainText('host-a')
    await expect(page.getByTestId('core-line')).toContainText('Core 0.1.17 · running for 3 h')
    await mkdir('.shots', { recursive: true })
    await page.screenshot({ path: `.shots/core-machines-${test.info().project.name}.png` })
    // host:port on a 0.1.17+ core goes through; the old-core message is covered by unit tests.
    await page.getByLabel('SSH target').fill('me@10.0.0.9:2222')
    await page.getByRole('button', { name: 'Add machine' }).click()
    await expect.poll(() => rpc.find(r => r.method === 'machine.add')?.params).toEqual({ target: 'me@10.0.0.9:2222' })
    await page.getByTestId('core-machine').filter({ hasText: 'host-a' }).getByTestId('machine-rename').click()
    await page.getByLabel('Name', { exact: true }).fill('renamed')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByTestId('core-machine').filter({ hasText: 'renamed' })).toBeVisible()
    expect(rpc.find(r => r.method === 'machine.rename')?.params).toEqual({ machine: 'host-a', new_name: 'renamed' })
    // No ghost: the old name is gone at once and the row count is unchanged.
    await expect(page.getByTestId('core-machine').filter({ hasText: 'host-a' })).toHaveCount(0)
    await expect(page.getByTestId('core-machine')).toHaveCount(2)
    await page.getByTestId('core-machine').filter({ hasText: 'renamed' }).getByTestId('machine-forget').click()
    await expect(page.getByText(/Forget renamed\?.*terminals keep running there/i)).toBeVisible()
    await page.screenshot({ path: `.shots/core-machines-forget-${test.info().project.name}.png` })
    // The home (another page) drops the forgotten machine's tab within a second, not on the next 4 s read.
    const home = await page.context().newPage()
    await home.goto(core.url + '/')
    const tabs = home.locator('[data-bar-id]')
    await expect(tabs.filter({ hasText: 'renamed' })).toHaveCount(1)
    const before = await tabs.count()
    await page.getByRole('button', { name: 'Forget', exact: true }).click()
    await expect(tabs).toHaveCount(before - 1, { timeout: 1000 })
    await expect(tabs.filter({ hasText: 'renamed' })).toHaveCount(0)
    await home.close()
    await expect(page.getByTestId('core-machine').filter({ hasText: 'renamed' })).toHaveCount(0)
    expect(rpc.find(r => r.method === 'machine.rm')?.params).toEqual({ machine: 'renamed' })
  } finally {
    await core.stop()
  }
})
