// App theme and mode (Dark, Light, System): chosen in Settings (kept on the
// server, so they follow the user across devices: useSyncedSettings.ts),
// applied right away through the data-theme and data-mode attributes of
// <html>, with the color of the iOS bar (theme-color) and the terminal palette.

import { settingsSync, syncedRef } from './useSyncedSettings'
import { BOOT_THEME_KEY } from '#shared/bootTheme'

export const themeChoice = syncedRef<string>('theme', storedThemeChoice, v => v)
export const themeMode = syncedRef<ThemeMode>('themeMode', storedThemeMode, v => v)

// A saved 2.x light theme (Catppuccin Latte, omp Light) becomes its family in
// Light mode, saved once so it follows the other devices too.
function migrateLightTheme(raw: string | null) {
  const to = legacyLightTheme(raw)
  if (!to) return
  settingsSync.write('theme', to)
  settingsSync.write('themeMode', 'light')
  themeMode.value = 'light'
}
if (import.meta.client) {
  try { migrateLightTheme(localStorage.getItem('theme')) } catch { /* storage off */ }
  settingsSync.bind('theme', migrateLightTheme)
}

// The system's light / dark preference, followed live in System mode.
const systemLight = ref(false)
if (import.meta.client) {
  const mq = matchMedia('(prefers-color-scheme: light)')
  systemLight.value = mq.matches
  mq.addEventListener('change', () => { systemLight.value = mq.matches })
}

// Theme actually shown, in the mode actually shown.
export const activeTheme = computed(() =>
  themeVariant(themeById(themeChoice.value) || themeById(DEFAULT_THEME)!, modeIsLight(themeMode.value, systemLight.value)))

// Color of the iOS bar (meta theme-color, set by useHead in app.vue).
export const themeColor = computed(() => activeTheme.value.c.bg)

function apply() {
  const root = document.documentElement
  root.dataset.theme = activeTheme.value.id
  root.dataset.mode = activeTheme.value.light ? 'light' : 'dark'
  // The startup background (nuxt.config.ts) gives way to the theme's styles,
  // and is this theme's next time.
  root.style.removeProperty('--bg')
  try { localStorage.setItem(BOOT_THEME_KEY, JSON.stringify({ bg: themeColor.value, light: activeTheme.value.light })) } catch { /* storage off: Titanium at startup */ }
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
}

// xterm palette of the theme shown.
export const terminalTheme = computed(() => xtermTheme(activeTheme.value))
