import { expect, test } from './test'
import { OMP_CHAT_PANE } from './scenario.mjs'

test('event payload handling, diagnostics and images remain available', { tag: ['@chromium-desktop', '@webkit-phone', '@webkit-desktop'] }, async ({ page }, info) => {
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


type PasteResult = { trusted: boolean, prevented: boolean, beforeRestore: string, payload: string }
type ClipboardField = HTMLTextAreaElement & { restored: Promise<PasteResult>, verified: Promise<string> }

test('native paste commits before clipboard restoration; compare original insertion', { tag: ['@chromium-desktop', '@webkit-phone', '@webkit-desktop'] }, async ({ page, context, browserName }) => {
  test.setTimeout(90_000)
  if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto(`/#/a/${OMP_CHAT_PANE}`)
  const field = page.locator('.prompt textarea')
  await expect(field).toBeVisible()
  await page.evaluate(() => {
    const writer = document.createElement('button') as HTMLButtonElement & { written?: Promise<void> }
    writer.id = 'clipboard-writer'
    writer.textContent = 'Write clipboard'
    writer.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483647'
    // A trusted click supplies WebKit's required clipboard user gesture.
    writer.onclick = () => { writer.written = navigator.clipboard.writeText(writer.dataset.text!) }
    document.body.append(writer)
    const probe = document.createElement('textarea')
    probe.id = 'clipboard-probe'
    document.body.append(probe)
  })
  for (const native of [true, false]) {
    for (const delay of native ? [0] : [0, 10, 50]) for (let i = 0; i < 5; i++) {
      const words = `Native dictation ${delay} ${i}`
      const expected = `Before ${words} after`
      await field.fill('Before replace after')
      await page.locator('#clipboard-writer').evaluate((el, text) => { (el as HTMLElement).dataset.text = text }, words)
      await page.locator('#clipboard-writer').click()
      await page.locator('#clipboard-writer').evaluate(el => (el as HTMLButtonElement & { written: Promise<void> }).written)
      await field.focus()
      await field.evaluate((el, { delay, native }) => {
        const field = el as ClipboardField
        field.setSelectionRange(7, 14)
        field.restored = new Promise((resolve, reject) => {
          const received = (e: ClipboardEvent) => {
            const payload = e.clipboardData!.getData('text/plain')
            const restore = async () => {
              const beforeRestore = field.value
              try {
                await navigator.clipboard.writeText('Previous clipboard')
                resolve({ trusted: e.isTrusted, prevented: e.defaultPrevented, beforeRestore, payload })
              } catch (error) { reject(error) }
            }
            if (delay) setTimeout(restore, delay)
            else void restore() // Same paste dispatch, after the composer handler.
          }
          if (native) {
            // Original ordinary-text path on the same Vue field: read and let
            // native insertion run after dispatch. Skip the new paste handlers.
            field.addEventListener('paste', e => {
              void e.clipboardData?.getData('text/plain')
              e.stopImmediatePropagation()
              received(e)
            }, { once: true, capture: true })
            field.addEventListener('beforeinput', e => e.stopImmediatePropagation(), { once: true, capture: true })
          } else document.addEventListener('paste', received, { once: true })
        })
      }, { delay, native })
      const shortcut = process.platform === 'darwin' ? 'Meta+V' : 'Control+V'
      await page.keyboard.press(shortcut)
      const result = await field.evaluate(el => (el as ClipboardField).restored)
      // Negative control: WebKit's old native path consumes the restored clipboard
      // at 0ms, despite the trusted event carrying the dictation's original text.
      await expect(field).toHaveValue(native && delay === 0 && browserName === 'webkit' ? 'Before Previous clipboard after' : expected)
      expect(result).toEqual({ trusted: true, prevented: !native, payload: words,
        beforeRestore: native && delay === 0 ? 'Before replace after' : expected })
      // Verify the actual clipboard through a second trusted paste, without a
      // privileged readText call or any clipboard API / event-data substitution.
      const probe = page.locator('#clipboard-probe')
      await probe.evaluate(el => {
        (el as ClipboardField).verified = new Promise(resolve => el.addEventListener('paste', e => {
          e.preventDefault()
          resolve((e as ClipboardEvent).clipboardData!.getData('text/plain'))
        }, { once: true }))
      })
      await probe.focus()
      await page.keyboard.press(shortcut)
      expect(await probe.evaluate(el => (el as ClipboardField).verified)).toBe('Previous clipboard')
    }
  }
})
