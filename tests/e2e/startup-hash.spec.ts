import { expect, test, type Page } from './test'
import { OMP_CHAT_PANE, SPLIT_CHAT_PANE, SPLIT_TAB } from './scenario.mjs'

// The address changes while the app starts. The scripts asked for after the
// change are held back, so its navigation is still loading its page when the
// app is created.
// `to`: the hash to set, or null to go back in the history.
async function changeWhileStarting(page: Page, to: string | null) {
  let changed = false
  await page.exposeFunction('addressChanged', () => { changed = true })
  await page.route('**/_nuxt/**', async (route) => {
    if (changed) await new Promise(resolve => setTimeout(resolve, 400))
    await route.continue()
  })
  await page.addInitScript((to) => {
    if (!sessionStorage.getItem('changeWhileStarting')) return
    addEventListener('DOMContentLoaded', () => {
      sessionStorage.removeItem('changeWhileStarting')
      if (to === null) history.back()
      else location.hash = to
      void (window as unknown as { addressChanged: () => Promise<void> }).addressChanged()
    })
  }, to)
}
const cell = (page: Page, mobile: boolean) => page.locator(`${mobile ? '.plan-cell' : '.cell-view'}[data-pane="${SPLIT_CHAT_PANE}"]`)
const arm = (page: Page) => page.evaluate(() => sessionStorage.setItem('changeWhileStarting', '1'))

test('an address set while the app starts is kept', async ({ page, isMobile }) => {
  await changeWhileStarting(page, `#/t/${SPLIT_TAB}`)
  await page.goto(`/#/a/${OMP_CHAT_PANE}`)
  await expect(page.locator('#agent')).toBeVisible()
  await arm(page)
  await page.reload()
  await expect(cell(page, isMobile)).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`#/t/${SPLIT_TAB}`))
})

test('Back pressed while the app reloads goes back', { tag: '@webkit-phone' }, async ({ page, isMobile }) => {
  await changeWhileStarting(page, null)
  await page.goto(`/#/t/${SPLIT_TAB}`)
  await expect(cell(page, isMobile)).toBeVisible()
  await page.evaluate((hash) => { location.hash = hash }, `#/a/${OMP_CHAT_PANE}`)
  await expect(page.locator('#agent')).toBeVisible()
  await arm(page)
  await page.reload()
  await expect(page).toHaveURL(new RegExp(`#/t/${SPLIT_TAB}`))
  await expect(page.locator('#agent')).toHaveCount(0)
  await expect(cell(page, isMobile)).toBeVisible()
})

test('a pasted deep link still opens its view', async ({ page }) => {
  await page.goto(`/a/${OMP_CHAT_PANE}`)
  await expect(page.locator('.chat').getByText('Ready when you are.')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/#/a/${OMP_CHAT_PANE}$`))
  await page.goto(`/t/${SPLIT_TAB}`)
  await expect(page).toHaveURL(new RegExp(`/#/t/${SPLIT_TAB}`))
})
