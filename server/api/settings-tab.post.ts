// Switch from the live tab, after moving Claude's settings-list focus to
// its tab bar. Never use Enter: it would toggle the selected setting.
import { settingsTabs, tabsOfRow, settingsRowIndex } from '../../shared/settingsScreen'

export default defineApi(async (_event, b) => {
  const pane = String(b.pane_id || '')
  if (!PANE_RE.test(pane)) throw new HerdrError('bad_pane', 'Invalid pane')
  if (findPane(pane)?.agent !== 'claude') throw new HerdrError('stale', 'Settings are no longer open.')
  const read = async () => {
    const r = await herdr('pane.read', { pane_id: pane, source: 'visible', format: 'ansi' }, 4000)
    const ansi = String(r.read?.text || '')
    // eslint-disable-next-line no-control-regex
    const text = ansi.replace(/\x1b\[[\d;]*m|\r/g, '')
    const tabs = settingsTabs(text)
    const row = ansi.split('\n').find(l => tabsOfRow(l.replace(/\x1b\[[\d;]*m|\r/g, ''))) // eslint-disable-line no-control-regex
    const tab = row && activeTab(row)
    if (!tabs || !tab || !tabs.includes(String(b.target))) throw new HerdrError('stale', 'Settings have changed.')
    return { text, tabs, tab }
  }
  let screen = await read()
  let focusPending = /↑ to tabs/.test(screen.text)
  const inList = (text: string) => text.split('\n').slice(settingsRowIndex(text.split('\n')) + 1).some(l => /^\s*❯\s+\S/.test(l))
  for (let i = 0; focusPending || inList(screen.text); i++) {
    if (i >= 100) throw new HerdrError('stale', 'Use the terminal to focus the settings tabs.')
    await herdr('pane.send_input', { pane_id: pane, keys: ['up'] })
    await sleep(40)
    screen = await read()
    focusPending = false
  }
  const distance = screen.tabs.indexOf(String(b.target)) - screen.tabs.indexOf(screen.tab)
  for (let i = 0; i < Math.abs(distance); i++) {
    await herdr('pane.send_input', { pane_id: pane, keys: [distance > 0 ? 'right' : 'left'] })
    await sleep(40)
  }
  choicesCache.delete(pane)
  return { ok: true }
})
