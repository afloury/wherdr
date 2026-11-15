// App theme: chosen in Settings (kept on the server, so it follows the user
// across devices: useSyncedSettings.ts), applied
// right away through the data-theme attribute of <html>, with the color of the
// iOS bar (theme-color) and the terminal palette.

import { syncedRef } from './useSyncedSettings'
import { BOOT_THEME_KEY } from '#shared/bootTheme'

export const themeChoice = syncedRef<string>('theme', storedThemeChoice, v => v)

// Theme actually shown.
export const activeTheme = computed(() => themeById(themeChoice.value) || themeById(DEFAULT_THEME)!)

// Color of the iOS bar (meta theme-color, set by useHead in app.vue).
export const themeColor = computed(() => activeTheme.value.c.bg)

function apply() {
  const root = document.documentElement
  root.dataset.theme = activeTheme.value.id
  // The startup background (nuxt.config.ts) gives way to the theme's styles,
  // and is this theme's next time.
  root.style.removeProperty('--bg')
  try { localStorage.setItem(BOOT_THEME_KEY, JSON.stringify({ bg: themeColor.value, light: Boolean(activeTheme.value.light) })) } catch { /* storage off: Titanium at startup */ }
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
