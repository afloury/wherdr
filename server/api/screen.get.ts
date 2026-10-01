// Current screen of the pane, as text: output of local commands (/context,
// /status…) that agents do not write to their transcript. Claude Code
// settings panel (/usage, /status…): `tab` = the active tab, spotted by
// its colored background in the ANSI version of the screen.
export default defineApi(async (event) => {
  const pane = String(getQuery(event).pane || '')
  if (!PANE_RE.test(pane)) throw new HerdrError('bad_pane', 'pane invalide')
  const r = await herdr('pane.read', { pane_id: pane, source: 'visible' }, 4000)
  const text: string = (r.read && r.read.text) || ''
  let tab: string | null = null
  if (/^\s*Settings\s+Status\s+Config\b/m.test(text)) {
    const a = await herdr('pane.read', { pane_id: pane, source: 'visible', format: 'ansi' }, 4000).catch(() => null)
    const line = String((a && a.read && a.read.text) || '').split('\n').find(l => l.includes('Settings') && l.includes('Status'))
    tab = line ? activeTab(line) : null
  }
  return { text, tab }
})
