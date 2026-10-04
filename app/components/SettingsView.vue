<script setup lang="ts">
// Settings, in sections: appearance, conversation, terminal, agents,
// notifications, security (passkey), computer, about.
import { startRegistration } from '@simplewebauthn/browser'
import type { AuthStatus } from '#shared/types'
import type { ThemeDef } from '~/utils/themes'
import type { TypingSpeed } from '~/utils/typewriter'
import pkg from '../../package.json'
import { SETTINGS_SECTIONS, settingsBack } from '~/utils/settingsNav'
import type { SettingsSection } from '~/utils/settingsNav'
import { type QuietDuration, type QuietScope, quietUntil } from '#shared/quiet'

const appVersion = pkg.version
const router = useRouter()
// Computer section: opens the keyboard shortcuts (ShortcutsSheet).
const shortcuts = shortcutsOpen
// Sections: sidebar on a computer (one section shown), iOS Settings-style
// list on the phone (a tap opens the section, Back returns to the list).
// The section lives in the URL (`?section=plugins`, also the Project panel's link):
// on the phone, opening it adds a history entry, which the system Back button
// pops like the header's; on a computer, it replaces the entry.
const route = useRoute()
const section = computed<SettingsSection | null>(() => (SETTINGS_SECTIONS as readonly string[]).includes(String(route.query.section)) ? route.query.section as SettingsSection : null)
const sectionIcons: Record<SettingsSection, string> = {
  appearance: 'i-lucide-palette', conversation: 'i-lucide-message-square', terminal: 'i-lucide-square-terminal',
  agents: 'i-lucide-bot', plugins: 'i-lucide-puzzle', notifications: 'i-lucide-bell', security: 'i-lucide-lock', desktop: 'i-lucide-monitor', about: 'i-lucide-info',
}
const sectionLabels: Record<SettingsSection, string> = {
  appearance: 'Appearance', conversation: 'Conversation', terminal: 'Terminal', agents: 'Agents',
  plugins: 'Plugins', notifications: 'Notifications', security: 'Security', desktop: 'Desktop', about: 'About',
}
const sections = computed(() => SETTINGS_SECTIONS
  .filter(id => id !== 'desktop' || desk.value)
  .map(id => ({ id, label: t(sectionLabels[id]), icon: sectionIcons[id] })))
const activeSection = computed<SettingsSection | null>(() => {
  if (section.value && sections.value.some(s => s.id === section.value)) return section.value
  return desk.value ? 'appearance' : null
})
const activeLabel = computed(() => sections.value.find(s => s.id === activeSection.value)?.label || t('Settings'))
const body = ref<HTMLElement | null>(null)
watch(section, () => nextTick(() => { if (body.value) body.value.scrollTop = 0 }))
function openSection(id: SettingsSection) {
  if (id === section.value) return
  const to = { path: '/settings', query: { section: id } }
  if (desk.value) router.replace(to)
  else router.push(to)
}
function back() {
  const to = settingsBack({ desk: desk.value, section: section.value, historyBack: (history.state as { back?: unknown } | null)?.back })
  if (to === 'list') router.replace('/settings')
  else if (to === 'history') router.back()
  else navigateTo('/', { replace: true })
}
// Phone, Settings opened first (app launched, link, reload): nothing
// underneath, the system Back button would close the app. We slip the home screen
// underneath, as if we came from the agent list.
onMounted(async () => {
  if (desk.value || typeof (history.state as { back?: unknown } | null)?.back === 'string') return
  const here = route.fullPath
  await router.replace('/')
  await router.push(here)
})
const lang = ref<Lang>(language)
watch(lang, (l) => {
  if (l === language) return
  setLanguage(l)
  location.reload()
})
// Global refs bound in the template: local (assignable) aliases.
const shellsOn = showShells
const countersOn = showCounters
const quotasOn = showQuotas
const autoReorderOn = autoReorderReady
const encryptedOn = encryptedText
const tokensComputerOn = quoteTokensComputer
const tokensPhoneOn = quoteTokensPhone
// Forced off if the system reduces motion: shown disabled.
const typewriter = computed({ get: () => typingSpeed.value, set: (v: TypingSpeed) => { typewriterSpeed.value = v } })
const typingItems = computed(() => [
  { label: t('Off'), description: t('The reply appears at once.'), value: 'off' },
  { label: t('Fast'), description: t('Original speed · 0.5 to 2 s.'), value: 'fast' },
  { label: t('Medium'), description: t('Twice as slow · 1 to 4 s.'), value: 'medium' },
  { label: t('Slow'), description: t('Three times as slow · 1.5 to 6 s.'), value: 'slow' },
])
const renderer = terminalRenderer
const width = contentWidth
const widthItems = computed(() => [
  { label: t('Normal'), description: t('760 px column · terminal fitted to width.'), value: 'normal' },
  { label: t('Wide'), description: t('Up to 1100 px · terminal fitted to width.'), value: 'wide' },
  { label: t('Full width'), description: t('The whole width, terminal included.'), value: 'full' },
])
// What an agent pane opens on (computer): the Conversation, or the Terminal.
const defaultPane = defaultViewMode
const defaultPaneItems = [
  { label: t('Conversation'), description: t('Read the transcript first.'), value: 'chat' },
  { label: t('Terminal'), description: t('Type straight into the pane.'), value: 'term' },
]
const quotaMode = quotaDisplay
const quotaItems = computed(() => [
  { label: t('Remaining'), description: t('What is left in each window, like Codex.'), value: 'left' },
  { label: t('Used'), description: t('What has been used, like Claude.'), value: 'used' },
])
const focusBorderMode = focusBorder
const focusBorderItems = computed(() => [
  { label: t('Border only'), description: t('A second color glides slowly around the border.'), value: 'border' },
  { label: t('Halo'), description: t('The same, with a faint glow around the field.'), value: 'halo' },
  { label: t('None'), description: t('Plain 1 px border, no animation.'), value: 'off' },
])
const langItems = [{ label: 'English', value: 'en' }, { label: 'Français', value: 'fr' }]

// Inventory of the reachable machines; the preferences stay specific to this device.
const agentMachines = computed(() => {
  const configured = appConfig.value.machines
  return configured?.filter(m => m.local || (Boolean(m.home) && (machineInfo(m.key)?.status === 'online' || (!machineInfo(m.key) && m.online))))
    || [{ key: '', label: hostLabel.value || t('This machine'), kinds: appConfig.value.kinds }]
})
const installedAgents = computed(() => [...new Set(agentMachines.value.flatMap(m => m.kinds || []))])
function agentChecked(kind: string) { return !hiddenAgents.value.includes(kind) }
function setAgentChecked(kind: string, checked: boolean) {
  hiddenAgents.value = checked
    ? hiddenAgents.value.filter(k => k !== kind)
    : [...hiddenAgents.value, kind]
}
function agentMachineHint(kind: string) {
  const available = agentMachines.value.filter(m => m.kinds.includes(kind))
  if (available.length === agentMachines.value.length) return ''
  return available.map(m => m.label || t('This machine')).join(', ')
}

// ------------------------------------------------------------ notifications
const subscribed = ref<boolean | null>(null)
const scopeItems = [
  { label: t('Project coordinators and agents outside projects'), value: 'project_leads' },
  { label: t('All agents'), value: 'all' },
]
const selectedScope = computed({
  get: () => notifyScope.value,
  set: (v: 'project_leads' | 'all') => { setNotifyScope(v).catch(e => toast((e as Error).message, true)) },
})
async function refreshPush() { subscribed.value = await pushSubscribed() }

// Quiet mode: scope (this device = its subscription, or all) and duration.
// The server keeps the setting and filters before sending (shared/quiet.ts).
const quietScope = ref<QuietScope>('all')
const quietDuration = ref<QuietDuration>('manual')
const quietScopeItems = computed(() => [
  { label: tl('This device', 'Cet appareil'), value: 'device', disabled: !subscribed.value },
  { label: tl('All devices', 'Tous les appareils'), value: 'all' },
])
const quietDurationItems = [
  { label: tl('1 hour', '1 heure'), value: 'hour' },
  { label: tl('Until tomorrow morning (8 am)', 'Jusqu’à demain matin (8 h)'), value: 'morning' },
  { label: tl('Until turned back on', 'Jusqu’à réactivation'), value: 'manual' },
]
watch(quietCurrent, (cur) => {
  if (!cur) return
  quietScope.value = cur.scope
  const left = cur.quiet.until === null ? null : cur.quiet.until - Date.now()
  quietDuration.value = left === null ? 'manual' : left <= 3600 * 1000 ? 'hour' : 'morning'
}, { immediate: true })
async function applyQuiet(on: boolean) {
  try {
    const previous = quietCurrent.value?.scope
    if (on) await setQuiet(quietScope.value, true, quietUntil(quietDuration.value))
    // Scope change: the old quiet period stops.
    if (previous && (!on || previous !== quietScope.value)) await setQuiet(previous, false)
  } catch (err) { toast((err as Error).message, true) }
}
const quietOn = computed({
  get: () => Boolean(quietCurrent.value),
  set: (v: boolean) => { applyQuiet(v) },
})
function pickQuietScope(v: QuietScope) { quietScope.value = v; if (quietOn.value) applyQuiet(true) }
function pickQuietDuration(v: QuietDuration) { quietDuration.value = v; if (quietOn.value) applyQuiet(true) }
const quietEnd = computed(() => {
  const cur = quietCurrent.value
  if (!cur) return ''
  const who = cur.scope === 'all' ? tl('all devices', 'tous les appareils') : tl('this device', 'cet appareil')
  if (cur.quiet.until === null) return tl(`Silenced on ${who} until turned back on.`, `Silence sur ${who} jusqu’à réactivation.`)
  const end = new Date(cur.quiet.until)
  const time = end.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' })
  const today = end.toDateString() === new Date(quietNow.value).toDateString()
  return today
    ? tl(`Silenced on ${who} until ${time}.`, `Silence sur ${who} jusqu’à ${time}.`)
    : tl(`Silenced on ${who} until tomorrow ${time}.`, `Silence sur ${who} jusqu’à demain ${time}.`)
})
async function pushAction() {
  if (await pushSubscribed()) await testPush()
  else await enablePush()
  refreshPush()
}
const pushNote = computed(() => t(subscribed.value
  ? 'You are notified when an agent needs your input or finishes.'
  : isIOS && !standalone
    ? 'On iPhone, add the app to your Home Screen (Share → Add to Home Screen) to receive notifications.'
    : 'Enable notifications to know when an agent needs your input.'))

// ------------------------------------------------------------ theme
// Preview: background, surface, line, text, accent, states (working, waiting, done).
const swatches = (th: ThemeDef) => [th.c.bg, th.c.surface, th.c.line, th.c.text, th.c.accent, th.c.blue, th.c.rose, th.c.teal]
const herdrName = computed(() => {
  const h = appConfig.value.herdrTheme
  if (!h) return null
  return h.autoSwitch ? `${h.darkName || 'catppuccin'} / ${h.lightName || 'catppuccin-latte'}` : h.name || 'catppuccin'
})
const followed = computed(() => themeById(resolveHerdrTheme(appConfig.value.herdrTheme, false).id))
const themesOpen = ref(false)
const currentTheme = computed(() => (themeChoice.value === FOLLOW_HERDR ? followed.value : themeById(themeChoice.value)))
const currentLabel = computed(() => (themeChoice.value === FOLLOW_HERDR
  ? `${t('Follow Herdr')}${followed.value ? ` · ${followed.value.label}` : ''}`
  : (currentTheme.value ? currentTheme.value.label : themeChoice.value)))
function pickTheme(id: string) {
  themeChoice.value = id
  haptic()
}

// ------------------------------------------------------------ texte du terminal
const changeFont = (d: number) => { fontSize.value = Math.max(8, Math.min(20, fontSize.value + d)) }
const rendererItems = [
  { label: 'WebGL', value: 'webgl' },
  { label: 'HTML', value: 'html' },
]
const rendererStatus = computed(() => terminalRenderStatus.value === 'html-fallback'
  ? t('Active rendering: HTML (WebGL unavailable)')
  : terminalRenderStatus.value === 'html'
    ? t('Active rendering: HTML')
    : t('Active rendering: WebGL'))
watch(renderer, refreshTerminalRenderStatus)

// ------------------------------------------------------------ security
const sec = ref<AuthStatus | null>(null)
const supported = import.meta.client && Boolean(window.PublicKeyCredential)
async function refreshSecurity() {
  try { sec.value = await api<AuthStatus>('/api/auth/status') }
  catch { /* offline */ }
}
// Readable device name, for the key list.
function deviceName() {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua) || (isIOS && !/iPhone/.test(ua))) return 'iPad'
  if (/Macintosh/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows'
  if (/Android/.test(ua)) return 'Android'
  return t('Device')
}
async function registerKey() {
  try {
    const bootstrapToken = sec.value?.enabled ? undefined : window.prompt(tl(
      'Bootstrap token (in server logs)',
      'Jeton d’amorçage (dans les journaux du serveur)',
    ))
    if (!sec.value?.enabled && !bootstrapToken) return
    const opts = await api<Parameters<typeof startRegistration>[0]['optionsJSON']>('/api/auth/register/options', { bootstrapToken })
    const response = await startRegistration({ optionsJSON: opts })
    await api('/api/auth/register/verify', { response, name: deviceName(), bootstrapToken })
    await start()
    toast(t('Lock enabled on this device ✓'))
  } catch (err) {
    const e = err as Error
    toast(e.name === 'NotAllowedError'
      ? t('Registration cancelled')
      : e.name === 'InvalidStateError' ? t('This device is already registered') : e.message, true)
  }
  refreshSecurity()
}
async function lockNow() {
  await api('/api/auth/lock', {}).catch(() => {})
  showLock()
}
async function disableLock() {
  if (!(await askConfirm(t('Turn off the lock? The app will be open again to anyone who can reach this server.'), t('Turn off')))) return
  try {
    await api('/api/auth/disable', {})
    clearOffline()
    await start()
    toast(t('Lock turned off'))
  } catch (err) { toast((err as Error).message, true) }
  refreshSecurity()
}

onMounted(loadUpdate)
onMounted(() => {
  refreshTerminalRenderStatus()
  loadConfig() // Herdr theme up to date for "Follow Herdr"
  refreshPush().then(refreshQuiet)
  refreshSecurity()
})
</script>

<template>
  <section id="settings" class="view settings-view">
    <header class="top bar settings-top">
      <UButton icon="i-lucide-chevron-left" color="neutral" variant="ghost" size="lg" class="icon-btn" :aria-label="t('Back')" @click="back" />
      <h2>{{ desk ? t('Settings') : activeLabel }}</h2>
    </header>
    <div class="settings-layout" :class="{ 'section-open': activeSection }">
      <nav class="settings-nav" :aria-label="t('Settings sections')">
        <button
          v-for="item in sections" :key="item.id" type="button" class="settings-nav-item"
          :class="{ selected: activeSection === item.id }" :aria-current="activeSection === item.id ? 'page' : undefined"
          @click="openSection(item.id)"
        >
          <UIcon :name="item.icon" /><span>{{ item.label }}</span><UIcon name="i-lucide-chevron-right" class="settings-nav-arrow" />
        </button>
      </nav>
      <div v-show="activeSection" ref="body" class="settings-body">
        <h2 class="settings-section-title">{{ activeLabel }}</h2>

        <div v-show="activeSection === 'appearance'" class="settings-section">
          <div class="settings-group">
            <h3>{{ t('Theme') }}</h3>
            <!-- Collapsed by default: the current theme shows, a tap expands the list. -->
            <button type="button" class="theme-opt theme-current" :aria-expanded="themesOpen" @click="themesOpen = !themesOpen">
              <span class="theme-sw"><i v-for="(c, i) in currentTheme ? swatches(currentTheme) : []" :key="i" :style="{ background: c }" /></span>
              <span class="theme-name">{{ currentLabel }}<small>{{ t(themesOpen ? 'Hide themes' : 'Change theme') }}</small></span>
              <UIcon :name="themesOpen ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="theme-check" />
            </button>
            <div v-show="themesOpen" class="theme-list" role="radiogroup" :aria-label="t('Theme')">
              <button
                type="button" role="radio" class="theme-opt" :class="{ on: themeChoice === FOLLOW_HERDR }" :aria-checked="themeChoice === FOLLOW_HERDR"
                @click="pickTheme(FOLLOW_HERDR)"
              >
                <span class="theme-sw">
                  <i v-for="(c, i) in followed ? swatches(followed) : []" :key="i" :style="{ background: c }" />
                </span>
                <span class="theme-name">{{ t('Follow Herdr') }}<small>{{ herdrName ? `config.toml · ${herdrName}` : t('config.toml not found') }}</small></span>
                <UIcon v-if="themeChoice === FOLLOW_HERDR" name="i-lucide-check" class="theme-check" />
              </button>
              <button
                v-for="th in THEMES" :key="th.id" type="button" role="radio" class="theme-opt" :class="{ on: themeChoice === th.id }"
                :aria-checked="themeChoice === th.id" @click="pickTheme(th.id)"
              >
                <span class="theme-sw"><i v-for="(c, i) in swatches(th)" :key="i" :style="{ background: c }" /></span>
                <span class="theme-name">{{ th.label }}<small v-if="th.id === DEFAULT_THEME">{{ t('default') }}</small><small v-else-if="th.light">{{ t('light') }}</small></span>
                <UIcon v-if="themeChoice === th.id" name="i-lucide-check" class="theme-check" />
              </button>
            </div>
          </div>
          <p class="muted settings-hint">{{ t('The theme is saved on this device.') }}</p>

          <div class="settings-group">
            <h3>{{ t('Message field border on focus') }}</h3>
            <URadioGroup v-model="focusBorderMode" :items="focusBorderItems" variant="table" indicator="end" color="primary" size="lg" class="settings-radio" />
            <p class="muted settings-hint">{{ t('Also on omp’s running actions (border only). Frozen when the system asks for reduced motion. Saved on this device.') }}</p>
          </div>

          <div class="settings-group">
            <h3>{{ t('Language') }}</h3>
            <URadioGroup v-model="lang" :items="langItems" variant="table" indicator="end" color="primary" size="lg" class="settings-radio" />
          </div>
          <p class="muted settings-hint">{{ t('The interface language is saved on this device.') }}</p>

          <div class="settings-group">
            <h3>{{ t('Home screen') }}</h3>
            <label class="settings-toggle">
              <span><b>{{ t('Reorder automatically') }}</b><small>{{ t('In Ready, show unread agents before read ones. Saved on this device.') }}</small></span>
              <USwitch v-model="autoReorderOn" color="success" size="xl" />
            </label>
            <label class="settings-toggle">
              <span><b>{{ t('Show terminals') }}</b><small>{{ t('Show terminal spaces in the list, filed under Ready.') }}</small></span>
              <USwitch v-model="shellsOn" color="success" size="xl" />
            </label>
            <label class="settings-toggle">
              <span><b>{{ t('Show counters') }}</b><small>{{ t('Show agent counters on the home screen.') }}</small></span>
              <USwitch v-model="countersOn" color="success" size="xl" />
            </label>
            <label class="settings-toggle">
              <span><b>{{ t('Show quotas') }}</b><small>{{ t('Show Claude and Codex quotas on the home screen.') }}</small></span>
              <USwitch v-model="quotasOn" color="success" size="xl" />
            </label>
          </div>

          <div class="settings-group">
            <h3>{{ t('Quotas') }}</h3>
            <URadioGroup v-model="quotaMode" :items="quotaItems" variant="table" indicator="end" color="primary" size="lg" class="settings-radio" />
            <p class="muted settings-hint">{{ t('The color always flags a nearly exhausted quota. Saved on this device.') }}</p>
          </div>
        </div>

        <div v-show="activeSection === 'conversation'" class="settings-section">
          <div class="settings-group settings-typing">
            <h3>{{ t('Typewriter') }}</h3>
            <URadioGroup v-model="typewriter" :items="typingItems" variant="table" indicator="end" color="primary" size="lg" class="settings-radio" :disabled="reducedMotion" />
            <p class="muted settings-hint">{{ t(reducedMotion ? 'Off: the system asks for reduced motion.' : 'Only new replies are animated; history appears at once. Tap a reply while it types to show it in full. Saved on this device only.') }}</p>
            <label class="settings-toggle encrypted-toggle" :class="{ 'is-disabled': !typewriterActive }">
              <span><b>{{ t('Encrypted text') }}</b><small>{{ t('Writing advances in glyphs, then the text decrypts behind it.') }}</small></span>
              <USwitch v-model="encryptedOn" :disabled="!typewriterActive" color="success" size="xl" />
            </label>
            <TypingPreview v-if="activeSection === 'conversation'" />
          </div>
          <div class="settings-group">
            <h3>{{ tl('Quoted replies', 'Réponses citées') }}</h3>
            <p class="muted settings-lead">{{ tl('Answer several questions or passages of an agent in one message: ↳ Reply quotes them in the field, each quote a compact token above its answer.', 'Réponds à plusieurs questions ou passages d’un agent dans un seul message : ↳ Répondre les cite dans le champ, chaque citation en jeton compact au-dessus de sa réponse.') }}</p>
            <QuoteTokensPreview v-if="activeSection === 'conversation'" />
            <label class="settings-toggle">
              <span><b>{{ tl('On a computer', 'Sur ordinateur') }}</b><small>{{ tl('On by default.', 'Activé par défaut.') }}</small></span>
              <USwitch v-model="tokensComputerOn" color="success" size="xl" />
            </label>
            <label class="settings-toggle">
              <span><b>{{ tl('On a phone', 'Sur téléphone') }}</b><small>{{ tl('Off by default: on iOS, moving the caret around the quotes is unreliable (a known limit of rich fields in Safari). Turn it on knowingly.', 'Désactivé par défaut : sur iOS, déplacer le curseur autour des citations est peu fiable (limite connue des champs riches dans Safari). À activer en connaissance de cause.') }}</small></span>
              <USwitch v-model="tokensPhoneOn" color="success" size="xl" />
            </label>
            <p class="muted settings-hint">{{ tl('Off: the quotes stay “> ” lines in the plain field, with a chip above to remove each. Saved on this device.', 'Désactivé : les citations restent des lignes « > » dans le champ simple, avec une puce au-dessus pour retirer chacune. Enregistré sur cet appareil.') }}</p>
          </div>
        </div>

        <div v-show="activeSection === 'terminal'" class="settings-section">
          <div class="settings-group">
            <h3>{{ t('Home screen') }}</h3>
            <label class="settings-toggle">
              <span><b>{{ t('Show terminals') }}</b><small>{{ t('Show terminal spaces in the list, filed under Ready.') }}</small></span>
              <USwitch v-model="shellsOn" color="success" size="xl" />
            </label>
          </div>
          <div class="settings-group">
            <h3>{{ t('Text') }}</h3>
            <div class="settings-stepper">
              <span>{{ t('Terminal text size') }}</span>
              <div>
                <button type="button" :aria-label="t('Decrease text size')" @click="changeFont(-1)">A−</button>
                <output>{{ fontSize }}</output>
                <button type="button" :aria-label="t('Increase text size')" @click="changeFont(1)">A+</button>
              </div>
            </div>
          </div>
          <div class="settings-group settings-renderer">
            <h3>{{ t('Terminal rendering') }}</h3>
            <URadioGroup v-model="renderer" :items="rendererItems" variant="table" indicator="end" color="primary" size="lg" class="settings-radio" />
            <p class="muted settings-hint">{{ t('Rendering is saved on this device.') }}</p>
            <p class="settings-renderer-status" role="status">{{ rendererStatus }}</p>
          </div>
        </div>

        <div v-show="activeSection === 'agents'" class="settings-section">
          <div class="settings-group">
            <h3>{{ t('New agent') }}</h3>
            <p class="muted agent-pref-intro">{{ t('Types shown in New agent. Terminal is always available.') }}</p>
            <div v-if="installedAgents.length" class="agent-pref-list">
              <label v-for="agent in installedAgents" :key="agent" class="settings-toggle">
                <span><b>{{ kindLabel(agent) }}</b><small v-if="agentMachineHint(agent)">{{ agentMachineHint(agent) }}</small></span>
                <input class="agent-pref-check" type="checkbox" :checked="agentChecked(agent)" @change="setAgentChecked(agent, ($event.target as HTMLInputElement).checked)">
              </label>
            </div>
            <p v-else class="muted agent-pref-intro">{{ t('No agents installed on online machines.') }}</p>
            <p class="muted agent-pref-note">{{ t('Choices saved on this device.') }}</p>
          </div>
          <WorktreesSection />
        </div>

        <div v-show="activeSection === 'notifications'" class="settings-section">
          <div class="settings-group">
            <label class="settings-toggle quiet-toggle">
              <span><b><UIcon :name="quietOn ? 'i-lucide-bell-off' : 'i-lucide-bell'" />{{ tl('Do not disturb', 'Silence') }}</b><small>{{ tl('No push notifications while it is on.', 'Aucune notification push tant qu’il est actif.') }}</small></span>
              <USwitch v-model="quietOn" color="success" size="xl" />
            </label>
            <p class="notify-caption">{{ tl('Silence on', 'Couper pour') }}</p>
            <URadioGroup :model-value="quietScope" :items="quietScopeItems" variant="table" indicator="end" color="primary" size="lg" class="settings-radio" @update:model-value="v => pickQuietScope(v as QuietScope)" />
            <p v-if="!subscribed" class="muted notify-hint">{{ tl('“This device” needs notifications turned on below.', '« Cet appareil » demande d’activer les notifications ci-dessous.') }}</p>
            <p class="notify-caption">{{ tl('Duration', 'Durée') }}</p>
            <URadioGroup :model-value="quietDuration" :items="quietDurationItems" variant="table" indicator="end" color="primary" size="lg" class="settings-radio" @update:model-value="v => pickQuietDuration(v as QuietDuration)" />
            <p class="muted notify-hint" :class="{ 'quiet-end': quietOn }">{{ quietEnd || tl('Notifications come back on by themselves at the end.', 'Retour automatique à la normale à la fin de la durée choisie.') }}</p>
          </div>
          <div class="settings-group">
            <div class="settings-card">
              <button type="button" class="settings-action" @click="pushAction">
                <UIcon name="i-lucide-bell" />{{ t(subscribed ? 'Send a test notification' : 'Enable notifications') }}
              </button>
              <p class="muted">{{ pushNote }}</p>
            </div>
            <p class="notify-caption">{{ t('Notify for') }}</p>
            <URadioGroup v-model="selectedScope" :items="scopeItems" variant="table" indicator="end" color="primary" size="lg" class="settings-radio" />
            <p class="muted notify-hint">{{ t('Project threads remain visible and their unread messages are kept.') }}</p>
          </div>
        </div>

        <div v-show="activeSection === 'plugins'" class="settings-section">
          <ProjectsPluginSettings :machines="appConfig.machines || [{ key: '', label: hostLabel || t('This machine'), local: true, home: '', dirs: [], online: true, kinds: [] }]" />
        </div>

        <div v-show="activeSection === 'security'" class="settings-section">
          <div class="settings-group">
            <h3>{{ t('Passkey') }}</h3>
            <div class="settings-card">
              <template v-if="sec && !sec.enabled">
                <button type="button" class="settings-action" :disabled="!supported" @click="registerKey">
                  <UIcon name="i-lucide-lock" />{{ t('Enable passkey lock') }}
                </button>
                <p class="muted">{{ t(supported ? 'Without a lock, anyone who can reach this server can control your agents. Passkey: Face ID, Touch ID, Windows Hello…' : 'This browser does not support passkeys.') }}</p>
              </template>
              <template v-else-if="sec">
                <p class="muted keys">{{ t('Registered keys:') }} {{ sec.devices.map(d => d.name).join(', ') }}</p>
                <button type="button" class="settings-action" @click="registerKey"><UIcon name="i-lucide-plus" />{{ t('Add this device') }}</button>
                <button type="button" class="settings-action" @click="lockNow"><UIcon name="i-lucide-lock" />{{ t('Lock now') }}</button>
                <button type="button" class="settings-action danger" @click="disableLock"><UIcon name="i-lucide-lock-open" />{{ t('Turn off lock') }}</button>
                <p class="muted">{{ hostLabel ? tl(`Unlocking lasts 12 h. Lost key: delete data/auth.json on ${hostLabel}.`, `Le déverrouillage dure 12 h. Clé perdue : supprimer data/auth.json sur ${hostLabel}.`) : tl('Unlocking lasts 12 h. Lost key: delete data/auth.json on the server.', 'Le déverrouillage dure 12 h. Clé perdue : supprimer data/auth.json sur le serveur.') }}</p>
              </template>
            </div>
          </div>
        </div>

        <!-- Computer layout only (same threshold as the app: 900 px). -->
        <div v-if="desk" v-show="activeSection === 'desktop'" class="settings-section">
          <div class="settings-group settings-width">
            <h3>{{ t('Content width') }}</h3>
            <URadioGroup v-model="width" :items="widthItems" variant="table" indicator="end" color="primary" size="lg" class="settings-radio" />
            <p class="muted settings-hint">{{ t('Conversation, terminal, settings and other content. Saved on this device.') }}</p>
          </div>
          <div class="settings-group">
            <h3>{{ t('Default pane view') }}</h3>
            <URadioGroup v-model="defaultPane" :items="defaultPaneItems" variant="table" indicator="end" color="primary" size="lg" class="settings-radio" />
            <p class="muted settings-hint">{{ t('What an agent pane opens on. A pane you switched to Terminal stays there. Saved on this device.') }}</p>
          </div>
          <div class="settings-group">
            <h3>{{ tl('Keyboard shortcuts', 'Raccourcis clavier') }}</h3>
            <button type="button" class="settings-action solo" @click="shortcuts = true">
              <UIcon name="i-lucide-keyboard" />{{ tl('Show keyboard shortcuts', 'Voir les raccourcis clavier') }}
              <span class="settings-action-keys"><UKbd v-for="k in shortcutKbds('help')" :key="k" :value="k" /></span>
            </button>
          </div>
        </div>

        <div v-show="activeSection === 'about'" class="settings-section">
          <div class="settings-group">
            <h3>{{ t('Application') }}</h3>
            <p class="settings-version">wherdr · v{{ appVersion }}</p>
            <UpdateBanner v-if="updateInfo?.latest" :info="updateInfo" />
            <p v-else-if="updateInfo?.checked" class="muted settings-hint">{{ t('This is the latest version.') }}</p>
            <button type="button" class="settings-action solo" @click="reloadApp"><UIcon name="i-lucide-refresh-cw" />{{ t('Reload app') }}</button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script lang="ts">
function reloadApp() { applyNewVersion() }
</script>
