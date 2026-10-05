// Herdr theme (config.toml) and resolution on the app side.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseHerdrTheme } from '../server/utils/herdrtheme'
import { DEFAULT_THEME, THEMES, customVars, mapHerdrTheme, resolveHerdrTheme, storedThemeChoice, themeVars, themesCss, xtermTheme } from '../app/utils/themes'

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
    expect(mapHerdrTheme('herdr', false)).toBe('catppuccin')
    expect(mapHerdrTheme('wherdr-titanium', false)).toBe('wherdr-titanium')
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
    const omp = THEMES.find(t => t.id === 'omp')!
    const ov = themeVars(omp)
    expect([ov['--bg'], ov['--accent'], ov['--green'], ov['--rose'], ov['--working'], ov['--blocked']]).toEqual(['#151820', '#f84fcc', '#00ff88', '#ff4757', '#00b4ff', '#ffb347'])
    // The selection takes the gradient's violet, not the accent.
    expect(ov['--selection']).toBe('color-mix(in srgb, #9362f4 32%, transparent)')
    expect(xtermTheme(omp).selectionBackground).toBe('rgba(147,98,244,0.32)')
    expect(themeVars(THEMES.find(t => t.id === 'codex')!)['--selection']).toBe('color-mix(in srgb, var(--accent) 32%, transparent)')
    expect(THEMES.find(t => t.id === 'omp-light')!.light).toBe(true)
    expect(THEMES.map(t => t.id)).toEqual(['herdr', 'claude-code', 'codex', 'omp', 'wherdr-neon', 'wherdr-neon-purple', 'wherdr-graphite', 'wherdr-titanium', 'catppuccin', 'terminal', 'tokyo-night', 'dracula', 'nord', 'gruvbox', 'one-dark', 'solarized', 'kanagawa', 'rose-pine', 'vesper', 'catppuccin-latte', 'omp-light'])
    // wherdr themes: the focus ring's second color comes from the theme.
    expect(themeVars(THEMES.find(t => t.id === 'wherdr-neon-purple')!)['--ring-2']).toBe('#2ee6ff')
    expect(themeVars(omp)['--ring-2']).toBeUndefined()
  })

  it('falls back to the default theme for a stored id that no longer exists', () => {
    expect(DEFAULT_THEME).toBe('wherdr-titanium')
    expect(storedThemeChoice('wherdr-synth', 'follow')).toBe(DEFAULT_THEME)
    expect(storedThemeChoice(null, 'follow')).toBe(DEFAULT_THEME)
    expect(storedThemeChoice('follow', 'follow')).toBe('follow')
    expect(storedThemeChoice('herdr', 'follow')).toBe('herdr')
    expect(storedThemeChoice('wherdr-graphite', 'follow')).toBe('wherdr-graphite')
    expect(themesCss()).toContain(':root[data-theme="herdr"]')
    expect(themesCss()).not.toContain(':root[data-theme="wherdr-titanium"]')
    expect(themeVars(THEMES[0]!)['--surface-2']).toBe('#26262b')
  })

  it('uses the Titanium background before the app loads and in both PWA manifests', () => {
    const background = THEMES.find(t => t.id === DEFAULT_THEME)!.c.bg
    const css = readFileSync(new URL('../app/assets/css/main.css', import.meta.url), 'utf8')
    expect(css.match(/:root\s*\{[^}]*--bg:\s*(#[0-9a-f]{6})/i)?.[1]).toBe(background)
    for (const name of ['manifest.webmanifest', 'manifest-en.webmanifest']) {
      const manifest = JSON.parse(readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8'))
      expect([manifest.background_color, manifest.theme_color]).toEqual([background, background])
    }
  })
})
