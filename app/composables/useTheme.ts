// Thème de l'app : choisi dans les Réglages (gardé sur l'appareil), appliqué
// tout de suite par l'attribut data-theme de <html>, avec la couleur de la
// barre iOS (theme-color) et la palette des terminaux. « Suivre Herdr » : le
// thème de ~/.config/herdr/config.toml, transmis par /api/config.

export const FOLLOW_HERDR = 'follow'

function readChoice() {
  try { return localStorage.getItem('theme') || DEFAULT_THEME }
  catch { return DEFAULT_THEME }
}
export const themeChoice = ref<string>(import.meta.client ? readChoice() : DEFAULT_THEME)

const systemLight = ref(false)
if (import.meta.client) {
  const mq = matchMedia('(prefers-color-scheme: light)')
  systemLight.value = mq.matches
  mq.addEventListener('change', () => { systemLight.value = mq.matches })
}

// Thème réellement affiché (+ jetons [theme.custom] de Herdr en mode suivi).
export const activeTheme = computed(() => {
  if (themeChoice.value === FOLLOW_HERDR) {
    const r = resolveHerdrTheme(appConfig.value.herdrTheme, systemLight.value)
    return { def: themeById(r.id) || THEMES[0]!, custom: customVars(r.custom) }
  }
  return { def: themeById(themeChoice.value) || THEMES[0]!, custom: {} as Record<string, string> }
})

// Couleur de la barre iOS (meta theme-color, posée par useHead dans app.vue).
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
  watch(themeChoice, (v) => {
    try { localStorage.setItem('theme', v) }
    catch { /* stockage indisponible */ }
  })
}

// Palette de xterm du thème affiché.
export const terminalTheme = computed(() => {
  const { def, custom } = activeTheme.value
  const th = xtermTheme(def)
  if (custom['--bg']) th.background = custom['--bg']
  if (custom['--text']) th.foreground = custom['--text']
  return th
})
