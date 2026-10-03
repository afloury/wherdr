import type { HerdrThemeConfig } from '#shared/types'

// App themes: the "herdr.dev" design (default, defined in main.css) and
// Herdr's built-in themes (official public palettes of each
// theme). Each theme gives a few base colors; the surfaces, lines
// and secondary texts are derived from them (color-mix), to keep the same
// structure everywhere. Applied through the data-theme attribute of <html>.

export interface ThemeColors {
  bg: string // background
  bg2: string // sidebar, windows
  surface: string // cards
  line: string // thin lines
  text: string
  muted: string
  dim: string
  accent: string // the equivalent of herdr.dev's mauve
  green: string
  coral: string
  ochre: string
  rose: string
  blue: string
  teal: string
  lav?: string
  onAccent?: string // text on the accent (default: the background)
  // Fine-tuning (otherwise derived): user bubbles, input field
  // outline, state colors (default: blue / pink / teal).
  surface2?: string
  inputLine?: string
  working?: string
  blocked?: string
  done?: string
}
export interface ThemeDef {
  id: string
  label: string
  light?: boolean
  c: ThemeColors
  // xterm ANSI palette: black, red, green, yellow, blue, magenta, cyan, white, then the bright ones.
  ansi: string[]
}

export const THEMES: ThemeDef[] = [
  {
    id: 'herdr', label: 'herdr.dev',
    c: {
      bg: '#17171a', bg2: '#1b1b1f', surface: '#1f1f24', line: '#35353d', text: '#eae8ee', muted: '#9399b2', dim: '#6c7086',
      accent: '#cba6f7', green: '#a6e3a1', coral: '#d97757', ochre: '#d9b66b', rose: '#f38ba8', blue: '#89b4fa', teal: '#94e2d5', lav: '#cdd6f4',
    },
    ansi: ['#45475a', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#cba6f7', '#94e2d5', '#bac2de',
      '#6c7086', '#f5a3b9', '#b9ebb4', '#fbe9c1', '#a4c4fb', '#d9bff9', '#abe9df', '#ffffff'],
  },
  {
    // Claude Code (v2.1.283, dark theme), colors captured in the terminal
    // (herdr pane read --format ansi): brand orange #d77757 (logo,
    // spinner), secondary text #999999, input field lines #888888,
    // user bubble #373737, permission #b1b9f9 (also inline
    // code), success #4eba65, warning / auto mode #ffc107, error
    // #ff6b80, plan mode #48968c, accept edits #af87ff, bash mode #fd5db1,
    // diffs +#50c850 / −#dc5a5a, monokai highlighting (#66d9ef, #a6e22e,
    // #e6db74). Background: the terminal's, here a neutral dark gray.
    id: 'claude-code', label: 'Claude Code',
    c: {
      bg: '#1a1a1a', bg2: '#151515', surface: '#222222', surface2: '#373737', line: '#3a3a3a', inputLine: '#888888',
      text: '#ffffff', muted: '#999999', dim: '#707070',
      accent: '#d77757', green: '#4eba65', coral: '#d77757', ochre: '#ffc107', rose: '#ff6b80', blue: '#b1b9f9', teal: '#48968c', lav: '#b1b9f9',
      working: '#d77757', blocked: '#b1b9f9', done: '#4eba65',
    },
    ansi: ['#3a3a3a', '#dc5a5a', '#50c850', '#e6db74', '#b1b9f9', '#af87ff', '#66d9ef', '#d0d0d0',
      '#707070', '#ff6b80', '#4eba65', '#ffc107', '#b1b9f9', '#fd5db1', '#66d9ef', '#ffffff'],
  },
  {
    // Codex CLI (v0.156.1), captured in the terminal: Codex mostly relies
    // on attributes (bold, dim, inverse for the selection) and the
    // terminal's ANSI colors (green = success and additions, red = errors and
    // deletions, cyan = diff headers); in true colors: blue
    // #63a8f8 (links, commands, update), model #f6e2b7 and folder
    // #abdfa7 on the status line, warning #c4a767, dimmed bullet
    // #808080, command highlighting #89b4fa / #9399b2 / #eba0ac. Background:
    // the terminal's, here a neutral dark gray.
    id: 'codex', label: 'Codex',
    c: {
      bg: '#171717', bg2: '#121212', surface: '#1f1f1f', line: '#3c3c3c',
      text: '#e6e6e6', muted: '#9a9a9a', dim: '#808080',
      accent: '#63a8f8', green: '#abdfa7', coral: '#eba0ac', ochre: '#c4a767', rose: '#e5737b', blue: '#63a8f8', teal: '#63c5d8', lav: '#89b4fa',
      working: '#63a8f8', done: '#abdfa7',
    },
    ansi: ['#2a2a2a', '#e5737b', '#8fcf8a', '#e7c787', '#89b4fa', '#c9a0e8', '#63c5d8', '#d4d4d4',
      '#6b6b6b', '#f38b95', '#abdfa7', '#f6e2b7', '#63a8f8', '#d7b4f0', '#8ad6e6', '#ffffff'],
  },
  {
    id: 'catppuccin', label: 'Catppuccin',
    c: {
      bg: '#1e1e2e', bg2: '#181825', surface: '#262637', line: '#45475a', text: '#cdd6f4', muted: '#9399b2', dim: '#6c7086',
      accent: '#cba6f7', green: '#a6e3a1', coral: '#fab387', ochre: '#f9e2af', rose: '#f38ba8', blue: '#89b4fa', teal: '#94e2d5', lav: '#b4befe',
    },
    ansi: ['#45475a', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#bac2de',
      '#585b70', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#a6adc8'],
  },
  {
    // Herdr uses the host terminal's ANSI colors here; here, a neutral gray
    // and the classic ANSI colors.
    id: 'terminal', label: 'Terminal',
    c: {
      bg: '#161616', bg2: '#1a1a1a', surface: '#1f1f1f', line: '#3a3a3a', text: '#e5e5e5', muted: '#a3a3a3', dim: '#737373',
      accent: '#d670d6', green: '#23d18b', coral: '#e8875b', ochre: '#e5e510', rose: '#f14c4c', blue: '#3b8eea', teal: '#29b8db', lav: '#cfcfcf',
    },
    ansi: ['#2e2e2e', '#cd3131', '#0dbc79', '#e5e510', '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5',
      '#666666', '#f14c4c', '#23d18b', '#f5f543', '#3b8eea', '#d670d6', '#29b8db', '#ffffff'],
  },
  {
    id: 'tokyo-night', label: 'Tokyo Night',
    c: {
      bg: '#1a1b26', bg2: '#16161e', surface: '#1f2335', line: '#3b4261', text: '#c0caf5', muted: '#a9b1d6', dim: '#565f89',
      accent: '#bb9af7', green: '#9ece6a', coral: '#ff9e64', ochre: '#e0af68', rose: '#f7768e', blue: '#7aa2f7', teal: '#7dcfff', lav: '#b4f9f8',
    },
    ansi: ['#15161e', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#a9b1d6',
      '#414868', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#c0caf5'],
  },
  {
    id: 'dracula', label: 'Dracula',
    c: {
      bg: '#282a36', bg2: '#21222c', surface: '#2e3040', line: '#44475a', text: '#f8f8f2', muted: '#b5b8cf', dim: '#6272a4',
      accent: '#bd93f9', green: '#50fa7b', coral: '#ffb86c', ochre: '#f1fa8c', rose: '#ff5555', blue: '#8be9fd', teal: '#8be9fd', lav: '#ff79c6',
    },
    ansi: ['#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2',
      '#6272a4', '#ff6e6e', '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff'],
  },
  {
    id: 'nord', label: 'Nord',
    c: {
      bg: '#2e3440', bg2: '#292e39', surface: '#343b49', line: '#4c566a', text: '#eceff4', muted: '#d8dee9', dim: '#7b88a1',
      accent: '#88c0d0', green: '#a3be8c', coral: '#d08770', ochre: '#ebcb8b', rose: '#bf616a', blue: '#81a1c1', teal: '#8fbcbb', lav: '#b48ead',
    },
    ansi: ['#3b4252', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#88c0d0', '#e5e9f0',
      '#4c566a', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#8fbcbb', '#eceff4'],
  },
  {
    id: 'gruvbox', label: 'Gruvbox',
    c: {
      bg: '#282828', bg2: '#1d2021', surface: '#32302f', line: '#504945', text: '#ebdbb2', muted: '#bdae93', dim: '#928374',
      accent: '#fabd2f', green: '#b8bb26', coral: '#fe8019', ochre: '#fabd2f', rose: '#fb4934', blue: '#83a598', teal: '#8ec07c', lav: '#d3869b',
    },
    ansi: ['#282828', '#cc241d', '#98971a', '#d79921', '#458588', '#b16286', '#689d6a', '#a89984',
      '#928374', '#fb4934', '#b8bb26', '#fabd2f', '#83a598', '#d3869b', '#8ec07c', '#ebdbb2'],
  },
  {
    id: 'one-dark', label: 'One Dark',
    c: {
      bg: '#282c34', bg2: '#21252b', surface: '#2c313a', line: '#3e4451', text: '#d7dae0', muted: '#abb2bf', dim: '#5c6370',
      accent: '#c678dd', green: '#98c379', coral: '#d19a66', ochre: '#e5c07b', rose: '#e06c75', blue: '#61afef', teal: '#56b6c2', lav: '#61afef',
    },
    ansi: ['#282c34', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#abb2bf',
      '#5c6370', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#ffffff'],
  },
  {
    id: 'solarized', label: 'Solarized',
    c: {
      bg: '#002b36', bg2: '#00252f', surface: '#073642', line: '#2a4f5a', text: '#eee8d5', muted: '#93a1a1', dim: '#657b83',
      accent: '#6c71c4', green: '#859900', coral: '#cb4b16', ochre: '#b58900', rose: '#dc322f', blue: '#268bd2', teal: '#2aa198', lav: '#93a1a1',
      onAccent: '#fdf6e3',
    },
    ansi: ['#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5',
      '#002b36', '#cb4b16', '#586e75', '#657b83', '#839496', '#6c71c4', '#93a1a1', '#fdf6e3'],
  },
  {
    id: 'kanagawa', label: 'Kanagawa',
    c: {
      bg: '#1f1f28', bg2: '#16161d', surface: '#2a2a37', line: '#54546d', text: '#dcd7ba', muted: '#c8c093', dim: '#727169',
      accent: '#957fb8', green: '#98bb6c', coral: '#ffa066', ochre: '#e6c384', rose: '#e46876', blue: '#7e9cd8', teal: '#7aa89f', lav: '#7fb4ca',
    },
    ansi: ['#090618', '#c34043', '#76946a', '#c0a36e', '#7e9cd8', '#957fb8', '#6a9589', '#c8c093',
      '#727169', '#e82424', '#98bb6c', '#e6c384', '#7fb4ca', '#938aa9', '#7aa89f', '#dcd7ba'],
  },
  {
    id: 'rose-pine', label: 'Rosé Pine',
    c: {
      bg: '#191724', bg2: '#1f1d2e', surface: '#21202e', line: '#403d52', text: '#e0def4', muted: '#908caa', dim: '#6e6a86',
      accent: '#c4a7e7', green: '#9ccfd8', coral: '#ebbcba', ochre: '#f6c177', rose: '#eb6f92', blue: '#31748f', teal: '#9ccfd8', lav: '#ebbcba',
    },
    ansi: ['#26233a', '#eb6f92', '#31748f', '#f6c177', '#9ccfd8', '#c4a7e7', '#ebbcba', '#e0def4',
      '#6e6a86', '#eb6f92', '#31748f', '#f6c177', '#9ccfd8', '#c4a7e7', '#ebbcba', '#e0def4'],
  },
  {
    id: 'vesper', label: 'Vesper',
    c: {
      bg: '#101010', bg2: '#141414', surface: '#1a1a1a', line: '#2e2e2e', text: '#ffffff', muted: '#a0a0a0', dim: '#707070',
      accent: '#ffc799', green: '#99ffe4', coral: '#ffc799', ochre: '#e6b99d', rose: '#ff8080', blue: '#aca1cf', teal: '#99ffe4', lav: '#b9aeda',
    },
    ansi: ['#101010', '#f5a191', '#90b99f', '#e6b99d', '#aca1cf', '#e29eca', '#ea83a5', '#a0a0a0',
      '#7e7e7e', '#ff8080', '#99ffe4', '#ffc799', '#b9aeda', '#ecaad6', '#f591b2', '#ffffff'],
  },
  {
    id: 'catppuccin-latte', label: 'Catppuccin Latte', light: true,
    c: {
      bg: '#eff1f5', bg2: '#e6e9ef', surface: '#e9ecf2', line: '#bcc0cc', text: '#4c4f69', muted: '#6c6f85', dim: '#8c8fa1',
      accent: '#8839ef', green: '#40a02b', coral: '#fe640b', ochre: '#df8e1d', rose: '#d20f39', blue: '#1e66f5', teal: '#179299', lav: '#7287fd',
      onAccent: '#ffffff',
    },
    ansi: ['#5c5f77', '#d20f39', '#40a02b', '#df8e1d', '#1e66f5', '#ea76cb', '#179299', '#acb0be',
      '#6c6f85', '#d20f39', '#40a02b', '#df8e1d', '#1e66f5', '#ea76cb', '#179299', '#bcc0cc'],
  },
]

export const DEFAULT_THEME = 'herdr'
export const themeById = (id: string | null | undefined) => THEMES.find(t => t.id === id)

// CSS variables of a theme (the herdr.dev theme keeps the values of main.css).
export function themeVars(th: ThemeDef): Record<string, string> {
  const c = th.c
  const mix = (a: string, p: number, b = 'var(--bg)') => `color-mix(in srgb, ${a} ${p}%, ${b})`
  return {
    '--bg': c.bg, '--bg-2': c.bg2, '--surface': c.surface,
    '--surface-2': c.surface2 || mix('var(--text)', th.light ? 9 : 7),
    '--surface-3': mix('var(--text)', th.light ? 14 : 11),
    '--line': c.line,
    '--line-soft': mix('var(--line)', 60),
    '--line-strong': mix('var(--text)', th.light ? 38 : 30),
    '--text': c.text,
    '--text-2': mix('var(--text)', 86),
    '--text-3': mix('var(--text)', 72),
    '--text-strong': th.light ? 'color-mix(in srgb, var(--text) 70%, #000)' : 'color-mix(in srgb, var(--text) 75%, #fff)',
    '--muted': c.muted, '--dim': c.dim, '--lav': c.lav || c.accent,
    '--mauve': c.accent, '--accent': c.accent, '--on-accent': c.onAccent || c.bg,
    '--green': c.green, '--coral': c.coral, '--ochre': c.ochre, '--rose': c.rose, '--blue': c.blue, '--teal': c.teal,
    '--code-bg': th.light ? mix('var(--text)', 5) : 'color-mix(in srgb, #000 22%, var(--bg))',
    // Agents' brand colors (logos and name in the list), identical in all themes:
    // orange of the Claude Code crab, blue-violet of the Codex icon, magenta of the omp pi.
    '--claude': '#d77757', '--codex': '#7a9dff', '--omp': '#c467e0',
    '--selection': `color-mix(in srgb, var(--accent) ${th.light ? 22 : 32}%, transparent)`,
    '--shadow': th.light ? 'rgba(60, 60, 80, .16)' : 'rgba(0, 0, 0, .5)',
    'color-scheme': th.light ? 'light' : 'dark',
    ...(c.inputLine ? { '--input-line': c.inputLine } : {}),
    ...(c.working ? { '--working': c.working } : {}),
    ...(c.blocked ? { '--blocked': c.blocked } : {}),
    ...(c.done ? { '--done': c.done, '--idle': c.done } : {}),
  }
}

// Stylesheet of all themes: [data-theme="…"] { --bg: … }.
export function themesCss(): string {
  return THEMES.filter(t => t.id !== DEFAULT_THEME)
    .map(t => `:root[data-theme="${t.id}"]{${Object.entries(themeVars(t)).map(([k, v]) => `${k}:${v}`).join(';')}}`)
    .join('\n')
}

// xterm theme: theme background and text, ANSI palette.
export function xtermTheme(th: ThemeDef) {
  const a = th.ansi
  const names = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']
  const out: Record<string, string> = {
    background: th.c.bg, foreground: th.c.text, cursor: th.c.accent, cursorAccent: th.c.bg,
    selectionBackground: hexAlpha(th.c.accent, th.light ? 0.25 : 0.32),
  }
  names.forEach((n, i) => {
    out[n] = a[i]!
    out[`bright${n[0]!.toUpperCase()}${n.slice(1)}`] = a[i + 8]!
  })
  return out
}
function hexAlpha(hex: string, alpha: number) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  return m ? `rgba(${parseInt(m[1]!, 16)},${parseInt(m[2]!, 16)},${parseInt(m[3]!, 16)},${alpha})` : hex
}

// ------------------------------------------------------------ "Follow Herdr"
// ~/.config/herdr/config.toml ([theme] name, auto_switch, dark_name, light_name,
// [theme.custom], [theme.custom.light|dark]), read by the server.

// App theme for the Herdr theme `name`; Herdr's light variants
// that we do not have (tokyo-night-day, gruvbox-light…) fall back to Catppuccin Latte.
export function mapHerdrTheme(name: string | null | undefined, preferLight: boolean): string {
  const n = String(name || '').trim().toLowerCase()
  if (themeById(n) && n !== DEFAULT_THEME) return n
  if (/-(day|light|dawn|lotus|latte)$/.test(n)) return 'catppuccin-latte'
  if (!n) return preferLight ? 'catppuccin-latte' : 'catppuccin' // Herdr's default
  return preferLight ? 'catppuccin-latte' : 'catppuccin'
}

export function resolveHerdrTheme(cfg: HerdrThemeConfig | null | undefined, systemLight: boolean) {
  if (!cfg) return { id: 'catppuccin', custom: {} as Record<string, string> }
  const name = cfg.autoSwitch ? (systemLight ? cfg.lightName || 'catppuccin-latte' : cfg.darkName || 'catppuccin') : cfg.name
  const light = cfg.autoSwitch ? systemLight : false
  const custom = { ...cfg.custom, ...(cfg.autoSwitch ? (systemLight ? cfg.customLight : cfg.customDark) : {}) }
  return { id: mapHerdrTheme(name, light), custom }
}

// Herdr's [theme.custom] tokens -> app CSS variables.
const CUSTOM_VARS: Record<string, string[]> = {
  panel_bg: ['--bg'], sidebar_bg: ['--bg-2'], active_row_bg: ['--surface'], surface_dim: ['--surface-2'],
  selection_bg: ['--selection'], accent: ['--accent', '--mauve'], text: ['--text'],
  green: ['--green'], yellow: ['--ochre'], red: ['--rose'], peach: ['--coral'], blue: ['--blue'],
}
export function customVars(custom: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(custom || {})) {
    if (!v || v === 'reset' || !/^(#[0-9a-f]{3,8}|[a-z]+|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\))$/i.test(v)) continue
    for (const cssVar of CUSTOM_VARS[k] || []) out[cssVar] = v
  }
  // `mauve` alone (without `accent`): it is the accent.
  if (custom && custom.mauve && !out['--accent'] && /^(#[0-9a-f]{3,8}|[a-z]+)$/i.test(custom.mauve)) out['--accent'] = out['--mauve'] = custom.mauve
  return out
}
