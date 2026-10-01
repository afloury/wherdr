// Herdr theme (config.toml) and resolution on the app side.
import { describe, expect, it } from 'vitest'
import { parseHerdrTheme } from '../server/utils/herdrtheme'
import { THEMES, customVars, mapHerdrTheme, resolveHerdrTheme, themeVars } from '../app/utils/themes'

describe('config.toml de Herdr', () => {
  it('lit [theme], [theme.custom] et ses variantes, ignore le reste', () => {
    const cfg = parseHerdrTheme(`
[ui]
name = "pas-ici"
[theme]
name = "terminal" # commentaire
auto_switch = false
dark_name = "tokyo-night"
light_name = "catppuccin-latte"
[theme.custom]
accent = "#f5c2e7"
panel_bg = "reset"
red = "rgb(255, 97, 136)"
evil = "red;}body{display:none"
[theme.custom.light]
text = "#4c4f69"
[terminal]
default_shell = ""
`)
    expect(cfg).toEqual({
      name: 'terminal', autoSwitch: false, darkName: 'tokyo-night', lightName: 'catppuccin-latte',
      custom: { accent: '#f5c2e7', panel_bg: 'reset', red: 'rgb(255, 97, 136)' }, customLight: { text: '#4c4f69' }, customDark: {},
    })
  })

  it('resolves the followed theme (light/dark switch, unknown variants)', () => {
    const base = { name: 'terminal', autoSwitch: false, darkName: null, lightName: null, custom: {}, customLight: {}, customDark: {} }
    expect(resolveHerdrTheme(base, true).id).toBe('terminal')
    expect(resolveHerdrTheme({ ...base, autoSwitch: true, darkName: 'nord' }, false).id).toBe('nord')
    expect(resolveHerdrTheme({ ...base, autoSwitch: true }, true).id).toBe('catppuccin-latte')
    expect(mapHerdrTheme('gruvbox-light', false)).toBe('catppuccin-latte')
    expect(mapHerdrTheme(null, false)).toBe('catppuccin')
    expect(customVars({ accent: '#f5c2e7', panel_bg: 'reset', red: 'rgb(1,2,3)' })).toEqual({ '--accent': '#f5c2e7', '--mauve': '#f5c2e7', '--rose': 'rgb(1,2,3)' })
  })

  it('each theme has its colors and 16 ANSI colors', () => {
    for (const th of THEMES) {
      expect(th.ansi).toHaveLength(16)
      for (const v of [...Object.values(th.c), ...th.ansi]) expect(v).toMatch(/^#[0-9a-f]{6}$/i)
      expect(themeVars(th)['--bg']).toBe(th.c.bg)
    }
    // Colors captured in the real terminals.
    const cc = themeVars(THEMES.find(t => t.id === 'claude-code')!)
    expect([cc['--accent'], cc['--surface-2'], cc['--input-line'], cc['--rose'], cc['--working'], cc['--blocked']]).toEqual(['#d77757', '#373737', '#888888', '#ff6b80', '#d77757', '#b1b9f9'])
    const cx = themeVars(THEMES.find(t => t.id === 'codex')!)
    expect([cx['--accent'], cx['--done'], cx['--idle']]).toEqual(['#63a8f8', '#abdfa7', '#abdfa7'])
    expect(THEMES.map(t => t.id)).toEqual(['herdr', 'claude-code', 'codex', 'catppuccin', 'terminal', 'tokyo-night', 'dracula', 'nord', 'gruvbox', 'one-dark', 'solarized', 'kanagawa', 'rose-pine', 'vesper', 'catppuccin-latte'])
  })
})
