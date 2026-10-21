import { expect, test, type Page } from '@playwright/test'
import { OMP_CHAT_PANE } from './scenario.mjs'

// Phone, keyboard open: one touch on Send sends, and the field keeps the focus
// (the keyboard stays up). On iOS, with the keyboard open the page can pan (the
// layout viewport is taller than the visible area): a finger that drifts by a
// pixel or two during the tap turns into a pan, and Safari never sends the
// synthetic click. The button acts on the touch itself, not on that click.

test.skip(({ isMobile }) => !isMobile, 'phone only')

async function openChat(page: Page) {
  await page.goto(`/#/a/${OMP_CHAT_PANE}`)
  await expect(page.locator('.chat').getByText('Ready when you are.')).toBeVisible()
  const field = page.locator('.prompt textarea').first()
  await field.click()
  return field
}

// A touch on the button that moves `drift` px before it lifts. Dispatched from
// the page: no browser turns it into a click, as iOS does not once it is a pan.
async function driftingTouch(page: Page, drift: number) {
  await page.locator('.prompt-send').evaluate((btn, d) => {
    const r = btn.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    // WebKit, like Safari, has no Touch constructor: an event carrying the lists.
    type T = { identifier: number, target: Element, clientX: number, clientY: number }
    const touch = (dx: number, dy: number): T => ({ identifier: 7, target: btn, clientX: x + dx, clientY: y + dy })
    const fire = (type: string, t: T, active: T[]) => {
      const e = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperties(e, { touches: { value: active }, targetTouches: { value: active }, changedTouches: { value: [t] } })
      btn.dispatchEvent(e)
    }
    const start = touch(0, 0)
    const moved = touch(d, -d)
    fire('touchstart', start, [start])
    fire('touchmove', moved, [moved])
    fire('touchend', moved, [])
  }, drift)
}

test('a touch on Send that drifts a little still sends, the field keeps the focus', async ({ page }, testInfo) => {
  const field = await openChat(page)
  const text = `Drifting tap (${testInfo.project.name} ${Date.now()})`
  await page.keyboard.type(text)
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${testInfo.project.name}-send-before-tap.png` })

  await driftingTouch(page, 3)

  if (process.env.SHOTS) {
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${process.env.SHOTS}/${testInfo.project.name}-send-after-tap.png` })
  }
  await expect(page.locator('.msg-user', { hasText: text })).toHaveCount(1)
  await expect(field).toHaveValue('')
  await expect(field).toBeFocused()
})

test('a touch that slides off Send does not send', async ({ page }, testInfo) => {
  const field = await openChat(page)
  const text = `Slid away (${testInfo.project.name} ${Date.now()})`
  await page.keyboard.type(text)

  await driftingTouch(page, 60)

  await page.waitForTimeout(400)
  await expect(page.locator('.msg-user', { hasText: text })).toHaveCount(0)
  await expect(field).toHaveValue(text)
})

test('a tap on Send sends once and keeps the focus in the field', async ({ page }, testInfo) => {
  const field = await openChat(page)
  const text = `One tap (${testInfo.project.name} ${Date.now()})`
  await page.keyboard.type(text)

  await page.locator('.prompt-send').tap()

  const sent = page.locator('.msg-user', { hasText: text })
  await expect(sent).toHaveCount(1)
  await expect(field).toHaveValue('')
  await expect(field).toBeFocused()
  // Settled into the transcript, still once (no second send from a late click).
  await expect(page.locator('.chat').getByText('Got it.').last()).toBeVisible()
  await expect(page.locator('.msg-user:not(.msg-pending)', { hasText: text })).toHaveCount(1)
})
