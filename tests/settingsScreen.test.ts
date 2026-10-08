// Claude Code's settings panel (/usage, /status, /config, /stats): screens
// captured from Claude Code 2.1.294 under Herdr 0.9.3, anonymized.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isKeyLegend, settingsTabs, tabsOfRow } from '../shared/settingsScreen'
import { parseMenu } from '../shared/menuScreen'
import { activeTab } from '../server/utils/settingstabs'
import { extractResult } from '../app/utils/commandResult'
import { parseMeters } from '../app/utils/meters'

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
// eslint-disable-next-line no-control-regex
const plain = (s: string) => s.replace(/\x1b\[[\d;]*m|\r/g, '')
const TABS = ['Status', 'Config', 'Usage', 'Stats']
const screens = {
  usage: fx('claude-settings-usage.ansi'),
  usageEnd: fx('claude-settings-usage-end.ansi'),
  status: fx('claude-settings-status.txt'),
  config: fx('claude-settings-config.txt'),
  stats: fx('claude-settings-stats.txt'),
}

describe('settings tab row', () => {
  it('reads the tabs as drawn, whatever their number', () => {
    expect(tabsOfRow('   Settings  Status   Config   Usage   Stats')).toEqual(TABS)
    expect(tabsOfRow('   Settings  Status   Config   Usage')).toEqual(['Status', 'Config', 'Usage'])
    expect(tabsOfRow('   Settings  Status   Config   Usage   Stats   Memory')).toEqual([...TABS, 'Memory'])
  })
  it('ignores ordinary lines mentioning settings', () => {
    expect(tabsOfRow('Settings saved')).toBeNull()
    expect(tabsOfRow('   Setting sources:   User settings')).toBeNull()
    expect(tabsOfRow('   Settings  Status')).toBeNull()
  })
  it('is found on every tab of the real panel', () => {
    for (const s of Object.values(screens)) expect(settingsTabs(plain(s))).toEqual(TABS)
  })
  it('spots the active tab in the ANSI row', () => {
    const row = screens.usage.split('\n').find(l => tabsOfRow(plain(l)))!
    expect(activeTab(row)).toBe('Usage')
  })
})

describe('the settings panel is not an interactive menu', () => {
  it('even with its "Esc to cancel" / "Esc to close" legend', () => {
    expect(plain(screens.usageEnd)).toMatch(/Esc to cancel/)
    expect(screens.config).toMatch(/Esc to close/)
    for (const s of Object.values(screens)) expect(parseMenu(s)).toBeNull()
  })
})

describe('key legends', () => {
  it('recognizes the panel\'s keyboard help', () => {
    expect(isKeyLegend('   Esc to cancel')).toBe(true)
    expect(isKeyLegend('   d to day · w to week')).toBe(true)
    expect(isKeyLegend('   ←/→/tab to switch · ↓ to return · Esc to close')).toBe(true)
  })
  it('keeps content lines', () => {
    expect(isKeyLegend('   Usage credits are off · /usage-credits to turn them on')).toBe(false)
    expect(isKeyLegend('   Last 24h · these are independent characteristics of your usage, not a breakdown')).toBe(false)
    expect(isKeyLegend('')).toBe(false)
  })
})

describe('settings card content', () => {
  const card = (s: string) => parseMeters(extractResult(plain(s), '/usage'))

  it('Usage: every gauge with its reset, including an empty one', () => {
    const r = card(screens.usage)
    expect(r.meters).toEqual([
      { label: 'Current session', pct: 20, kind: 'used', reset: '4pm (Europe/Paris)' },
      { label: 'Current week (all models)', pct: 53, kind: 'used', reset: 'Oct 14, 9pm (Europe/Paris)' },
      { label: 'Current week (Sonnet)', pct: 0, kind: 'used', reset: 'Oct 14, 9pm (Europe/Paris)' },
    ])
    expect(r.rest.split('\n')[0]).toMatch(/^\s*Total cost:\s+\$1\.23$/)
    expect(r.rest).toMatch(/\n\s*Total duration \(API\):/)
    expect(r.rest).toContain("What's contributing to your limits usage?")
    expect(r.rest).not.toMatch(/[↑↓]/)
  })

  it('Usage, scrolled to the end: no tab row nor keyboard help', () => {
    const r = card(screens.usageEnd)
    expect(r.meters.map(m => m.pct)).toEqual([53, 0])
    expect(r.rest).toContain('Usage credits are off')
    expect(r.rest).not.toMatch(/Settings\s+Status|Esc to cancel|d to day/)
  })

  it('Status: one field per line', () => {
    const r = card(screens.status)
    expect(r.meters).toEqual([])
    const lines = r.rest.split('\n')
    expect(lines[0]).toMatch(/^\s*Version:\s+2\.1\.294$/)
    expect(lines.some(l => /^\s*Model:\s+sonnet/.test(l))).toBe(true)
    expect(r.rest).not.toContain('Esc to cancel')
  })

  it('Config: the setting list without its legend', () => {
    const r = card(screens.config)
    expect(r.rest).toMatch(/❯ Auto-compact\s+true/)
    expect(r.rest).toMatch(/\n\s+Show tips\s+true/)
    expect(r.rest).not.toContain('Esc to close')
  })

  it('Stats: the summary lines', () => {
    const r = card(screens.stats)
    expect(r.rest).toMatch(/Sessions: 42\s+Longest session/)
    expect(r.rest).toMatch(/Input 1\.0k · Output 2\.0k/)
    expect(r.rest).not.toMatch(/↓ stats/)
  })
})
