// Switch using observed focus and verify each tab transition. Horizontal keys
// in Config's list may open a setting editor, so never send them there.
import { settingsTabs, tabsOfRow, settingsFocus } from '../../shared/settingsScreen'

const switching = new Set<string>()

export default defineApi(async (_event, b) => {
  const pane = String(b.pane_id || '')
  const target = String(b.target || '')
  if (!PANE_RE.test(pane)) throw new HerdrError('bad_pane', 'Invalid pane')
  if (findPane(pane)?.agent !== 'claude') throw new HerdrError('stale', 'Settings are no longer open.')
  if (switching.has(pane)) throw new HerdrError('busy', 'Settings tab change already in progress.')
  const read = async () => {
    const r = await herdr('pane.read', { pane_id: pane, source: 'visible', format: 'ansi' }, 4000)
    const ansi = String(r.read?.text || '')
    // eslint-disable-next-line no-control-regex
    const text = ansi.replace(/\x1b\[[\d;]*m|\r/g, '')
    const tabs = settingsTabs(text)
    const row = ansi.split('\n').find(l => tabsOfRow(l.replace(/\x1b\[[\d;]*m|\r/g, ''))) // eslint-disable-line no-control-regex
    const tab = row && activeTab(row)
    if (!tabs || !tab || !tabs.includes(tab) || !tabs.includes(target)) throw new HerdrError('stale', 'Settings have changed.')
    return { text, tabs, tab, ansi }
  }
  switching.add(pane)
  try {
    let screen = await read()
    for (let step = 0; screen.tab !== target; step++) {
      if (step >= screen.tabs.length) throw new HerdrError('stale', 'Could not switch settings tabs. Open the terminal and try again.')
      // Check focus at every step, including when passing through Config;
      // never infer tab focus from the remembered setting cursor.
      for (let up = 0; screen.tab === 'Config' && settingsFocus(screen.text) !== 'tabs'; up++) {
        if (up >= 100 || settingsFocus(screen.text) === null) throw new HerdrError('stale', 'Use the terminal to focus the settings tabs.')
        const before = screen
        await herdr('pane.send_input', { pane_id: pane, keys: ['up'] })
        for (let attempt = 0; attempt < 15; attempt++) {
          await sleep(100)
          screen = await read()
          if (screen.ansi !== before.ansi) break
        }
        if (screen.tab !== before.tab) throw new HerdrError('stale', 'Settings have changed.')
        if (screen.ansi === before.ansi) throw new HerdrError('stale', 'Use the terminal to focus the settings tabs.')
      }
      if (screen.tab === target) break
      const direction = screen.tabs.indexOf(target) > screen.tabs.indexOf(screen.tab) ? 1 : -1
      const next = screen.tabs[screen.tabs.indexOf(screen.tab) + direction]!
      const previous = screen.tab
      await herdr('pane.send_input', { pane_id: pane, keys: [direction > 0 ? 'right' : 'left'] })
      // ANSI can lag the key acknowledgment. Wait for its highlight, without
      // repeating a horizontal key and accidentally skipping a tab.
      for (let attempt = 0; attempt < 15; attempt++) {
        await sleep(100)
        screen = await read()
        if (screen.tab !== previous) break
      }
      if (screen.tab !== next) throw new HerdrError('stale', 'Could not switch settings tabs. Open the terminal and try again.')
    }
    return { ok: true, tab: screen.tab }
  } finally {
    choicesCache.delete(pane)
    switching.delete(pane)
  }
})
