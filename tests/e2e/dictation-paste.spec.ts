import { expect, test } from './test'
import { OMP_CHAT_PANE } from './scenario.mjs'

test('dictation survives immediate clipboard restoration; diagnostics and images remain available', { tag: ['@chromium-phone', '@chromium-desktop', '@webkit-phone', '@webkit-desktop'] }, async ({ page }, info) => {
  await page.goto('/#/settings?section=advanced')
  const section = page.locator('.settings-section:visible')
  await expect(section.getByRole('switch')).not.toBeChecked()
  await section.getByRole('switch').click()
  await page.goto(`/#/a/${OMP_CHAT_PANE}`)
  const field = page.locator('.prompt textarea')
  await field.fill('Before replace after')
  // The event data is a live clipboard mock: restore it in the same tick,
  // or shortly afterwards, and make late system clipboard reads fail.
  for (const delay of [0, 10, 50]) {
    for (let i = 0; i < 5; i++) {
      await field.fill('Before replace after')
      await field.focus()
      await field.evaluate((el, { delay, i }) => {
        const field = el as HTMLTextAreaElement
        field.setSelectionRange(7, 14)
        let clipboard = `Dictation ${i}`
        const data = new DataTransfer()
        data.setData('text/plain', clipboard)
        Object.defineProperty(data, 'getData', { value: (type: string) => type === 'text/plain' ? clipboard : '' })
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: () => { throw new Error('Late clipboard read') }, read: () => { throw new Error('Late clipboard read') } } })
        field.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
        const restore = () => { clipboard = 'Previous clipboard' }
        if (delay) setTimeout(restore, delay)
        else restore()
      }, { delay, i })
      await page.waitForTimeout(delay + 5)
      await expect(field).toHaveValue(`Before Dictation ${i} after`)
    }
  }
  // A beforeinput-only dictation tool supplies its text on InputEvent.
  await field.fill('')
  await field.evaluate(el => el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertFromPaste', data: 'Input dictation', bubbles: true, cancelable: true })))
  await expect(field).toHaveValue('Input dictation')
  // Exercise the same clipboard File path used by iPhone screenshots.
  await field.evaluate(el => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='), c => c.charCodeAt(0))
    const data = new DataTransfer()
    data.items.add(new File([bytes], 'clipboard.png', { type: 'image/png' }))
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  })
  await expect(page.locator('.prompt .attachments img')).toBeVisible()
  await expect(field).toHaveValue('Input dictation')
  await page.goto('/#/settings?section=advanced')
  const journal = page.locator('.paste-journal')
  await expect(journal).toContainText('beforeinput')
  await expect(journal).toContainText('Files')
  await expect(journal).toContainText('"modified": true')
  await expect(journal).not.toContainText('Input dictation')
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport)
    await expect(journal).toBeVisible()
    await page.screenshot({ path: `.shots/${info.project.name}-paste-journal-${viewport.width}.png` })
  }
  await page.locator('.settings-section:visible').getByRole('switch').click()
  await expect(journal).toHaveText('[]')
})
