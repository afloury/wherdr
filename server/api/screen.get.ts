import { settingsTabs, tabsOfRow } from '../../shared/settingsScreen'

// Current screen of the pane, as text: output of local commands (/context,
// /status…) that agents do not write to their transcript. Claude Code
// settings panel (/usage, /status…): `tabs` = its tabs as drawn, `tab` = the
// active one, spotted by its highlight in the ANSI version of the screen.
export default defineApi(async (event) => {
  const pane = String(getQuery(event).pane || '')
  if (!PANE_RE.test(pane)) throw new HerdrError('bad_pane', 'Invalid pane')
  const r = await herdr('pane.read', { pane_id: pane, source: 'visible' }, 4000)
  const text: string = (r.read && r.read.text) || ''
  const tabs = settingsTabs(text)
  let tab: string | null = null
  if (tabs) {
    const a = await herdr('pane.read', { pane_id: pane, source: 'visible', format: 'ansi' }, 4000).catch(() => null)
    // eslint-disable-next-line no-control-regex
    const line = String((a && a.read && a.read.text) || '').split('\n').find(l => tabsOfRow(l.replace(/\x1b\[[\d;]*m|\r/g, '')))
    const hit = line ? activeTab(line) : null
    tab = hit && tabs.includes(hit) ? hit : null
  }
  return { text, tabs, tab }
})
