// App theme: chosen in Settings (kept on the server, so it follows the user
// across devices: useSyncedSettings.ts), applied
// right away through the data-theme attribute of <html>, with the color of the
// iOS bar (theme-color) and the terminal palette. "Follow Herdr": the
// theme of ~/.config/herdr/config.toml, passed by /api/config.

import { syncedRef } from './useSyncedSettings'

export const FOLLOW_HERDR = 'follow'

export const themeChoice = syncedRef<string>('theme', raw => storedThemeChoice(raw, FOLLOW_HERDR), v => v)

// Border of the focused message field (utils/focusBorder.ts).
export const focusBorder = syncedRef<FocusBorder>('focusBorder', parseFocusBorder, v => v)

// Background in the conversation margins on a computer (utils/backdrop.ts).
export const backdrop = syncedRef<Backdrop>('backdrop', parseBackdrop, v => v)
// Light packets running on the wherdr grid; off: the grid stays still.
export const backdropPackets = syncedRef('backdropPackets', raw => raw !== 'off', v => (v ? 'on' : 'off'))

const systemLight = ref(false)
if (import.meta.client) {
  const mq = matchMedia('(prefers-color-scheme: light)')
  systemLight.value = mq.matches
  mq.addEventListener('change', () => { systemLight.value = mq.matches })
}

// Theme actually shown (+ Herdr's [theme.custom] tokens in follow mode).
export const activeTheme = computed(() => {
  if (themeChoice.value === FOLLOW_HERDR) {
    const r = resolveHerdrTheme(appConfig.value.herdrTheme, systemLight.value)
    return { def: themeById(r.id) || themeById(DEFAULT_THEME)!, custom: customVars(r.custom) }
  }
  return { def: themeById(themeChoice.value) || themeById(DEFAULT_THEME)!, custom: {} as Record<string, string> }
})

// Color of the iOS bar (meta theme-color, set by useHead in app.vue).
export const themeColor = computed(() => activeTheme.value.custom['--bg'] || activeTheme.value.def.c.bg)

let applied: string[] = []
function apply() {
  const { def, custom } = activeTheme.value
  const root = document.documentElement
  root.dataset.theme = def.id
  for (const k of applied) root.style.removeProperty(k)
  applied = Object.keys(custom)
  for (const [k, v] of Object.entries(custom)) root.style.setProperty(k, v)
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.setAttribute('content', themeColor.value)
}

export function installTheme() {
  if (!document.getElementById('hw-themes')) {
    const style = document.createElement('style')
    style.id = 'hw-themes'
    style.textContent = themesCss()
    document.head.appendChild(style)
  }
  apply()
  watch(activeTheme, apply)
  watch(focusBorder, (v) => { document.documentElement.dataset.focusBorder = v }, { immediate: true })
  watch(backdrop, (v) => { document.documentElement.dataset.backdrop = v }, { immediate: true })
}

// xterm palette of the theme shown.
export const terminalTheme = computed(() => {
  const { def, custom } = activeTheme.value
  const th = xtermTheme(def)
  if (custom['--bg']) th.background = custom['--bg']
  if (custom['--text']) th.foreground = custom['--text']
  return th
})
