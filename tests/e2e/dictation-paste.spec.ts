import { expect, test } from './test'
import { OMP_CHAT_PANE } from './scenario.mjs'

test('event payload handling, diagnostics and images remain available', { tag: ['@chromium-phone', '@chromium-desktop', '@webkit-phone', '@webkit-desktop'] }, async ({ page }, info) => {
  // Image upload and two viewport captures can exceed 30s on mobile.
  test.setTimeout(60_000)
  await page.goto('/#/settings?section=advanced')
  const section = page.locator('.settings-section:visible')
  await expect(section.getByRole('switch')).not.toBeChecked()
  await section.getByRole('switch').click()
  await page.goto(`/#/a/${OMP_CHAT_PANE}`)
  const field = page.locator('.prompt textarea')
  for (const [html, expected] of [
    ['<p>Bonjour</p><p>le monde</p>', 'Bonjour\n\nle monde'],
    ['Bonjour<br>le monde', 'Bonjour\nle monde'],
  ]) {
    await field.fill('')
    await field.evaluate((el, html) => {
      const data = new DataTransfer()
      data.setData('text/html', html!)
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
      data.clearData()
    }, html)
    await expect(field).toHaveValue(expected!)
  }
  // Synthetic beforeinput covers the event handler, not a native paste.
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


test('native clipboard restoration: composer with captured and original native insertion', { tag: ['@chromium-phone', '@chromium-desktop'] }, async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Clipboard permissions are supported by Chromium only.')
  test.setTimeout(90_000)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto(`/#/a/${OMP_CHAT_PANE}`)
  await expect(page.locator('.prompt textarea')).toBeVisible()
  const field = page.locator('.prompt textarea')
  for (const native of [true, false]) {
    for (const delay of [0, 10, 50]) for (let i = 0; i < 5; i++) {
      const words = `Native dictation ${delay} ${i}`
      await field.fill('Before replace after')
      await field.focus()
      await page.evaluate(text => navigator.clipboard.writeText(text), words)
      await field.evaluate((el, { delay, native }) => {
        const field = el as HTMLTextAreaElement & { restored?: Promise<{ trusted: boolean, prevented: boolean, clipboard: string }> }
        field.setSelectionRange(7, 14)
        field.restored = new Promise((resolve, reject) => {
          field.addEventListener('paste', e => {
            const restore = async () => {
              try {
                await navigator.clipboard.writeText('Previous clipboard')
                resolve({ trusted: e.isTrusted, prevented: e.defaultPrevented, clipboard: await navigator.clipboard.readText() })
              } catch (error) { reject(error) }
            }
            // Zero calls the real clipboard API inside the trusted paste event.
            if (delay) setTimeout(restore, delay)
            else void restore()
          }, { once: true, capture: true })
        })
        if (native) {
          // Restore the original ordinary-text event path on the same Vue field:
          // read the payload, skip the new handlers, let native input update v-model.
          field.addEventListener('paste', e => {
            void e.clipboardData?.getData('text/plain')
            e.stopImmediatePropagation()
          }, { once: true, capture: true })
          field.addEventListener('beforeinput', e => e.stopImmediatePropagation(), { once: true, capture: true })
        }
      }, { delay, native })
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V')
      const result = await field.evaluate(el => (el as HTMLTextAreaElement & { restored: Promise<{ trusted: boolean, prevented: boolean, clipboard: string }> }).restored)
      expect(result).toEqual({ trusted: true, prevented: !native, clipboard: 'Previous clipboard' })
      await expect(field).toHaveValue(`Before ${words} after`)
    }
  }
})
