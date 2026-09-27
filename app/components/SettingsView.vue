<script setup lang="ts">
// Réglages, en sections : apparence, conversation, terminal, agents,
// notifications, sécurité (clé d'accès), ordinateur, à propos.
import { startRegistration } from '@simplewebauthn/browser'
import type { AuthStatus } from '#shared/types'
import type { ThemeDef } from '~/utils/themes'
import type { TypingSpeed } from '~/utils/typewriter'
import pkg from '../../package.json'
import { SETTINGS_SECTIONS, settingsBack } from '~/utils/settingsNav'
import type { SettingsSection } from '~/utils/settingsNav'

const appVersion = pkg.version
const router = useRouter()
// Sections : barre latérale sur ordinateur (une section affichée), liste façon
// Réglages iOS sur téléphone (un appui ouvre la section, Retour revient à la liste).
const section = ref<SettingsSection | null>(null)
const sectionIcons: Record<SettingsSection, string> = {
  appearance: 'i-lucide-palette', conversation: 'i-lucide-message-square', terminal: 'i-lucide-square-terminal',
  agents: 'i-lucide-bot', notifications: 'i-lucide-bell', security: 'i-lucide-lock', desktop: 'i-lucide-monitor', about: 'i-lucide-info',
}
const sectionLabels: Record<SettingsSection, string> = {
  appearance: 'Apparence', conversation: 'Conversation', terminal: 'Terminal', agents: 'Agents',
  notifications: 'Notifications', security: 'Sécurité', desktop: 'Ordinateur', about: 'À propos',
}
const sections = computed(() => SETTINGS_SECTIONS
  .filter(id => id !== 'desktop' || desk.value)
  .map(id => ({ id, label: t(sectionLabels[id]), icon: sectionIcons[id] })))
const activeSection = computed<SettingsSection | null>(() => {
  if (section.value && sections.value.some(s => s.id === section.value)) return section.value
  return desk.value ? 'appearance' : null
})
const activeLabel = computed(() => sections.value.find(s => s.id === activeSection.value)?.label || t('Réglages'))
const body = ref<HTMLElement | null>(null)
function openSection(id: SettingsSection) {
  section.value = id
  nextTick(() => { if (body.value) body.value.scrollTop = 0 })
}
function back() {
  const to = settingsBack({ desk: desk.value, section: section.value, historyBack: (history.state as { back?: unknown } | null)?.back })
  if (to === 'list') section.value = null
  else if (to === 'history') router.back()
  else navigateTo('/')
}
const lang = ref<Lang>(language)
watch(lang, (l) => {
  if (l === language) return
  setLanguage(l)
  location.reload()
})
// Refs globales liées dans le gabarit : alias locaux (assignables).
const shellsOn = showShells
const countersOn = showCounters
const quotasOn = showQuotas
const autoReorderOn = autoReorderReady
const encryptedOn = encryptedText
// Coupée d'office si le système réduit les animations : montrée désactivée.
const typewriter = computed({ get: () => typingSpeed.value, set: (v: TypingSpeed) => { typewriterSpeed.value = v } })
const typingItems = computed(() => [
  { label: t('Désactivée'), description: t('La réponse s’affiche d’un coup.'), value: 'off' },
  { label: t('Rapide'), description: t('Vitesse d’origine · 0,5 à 2 s.'), value: 'fast' },
  { label: t('Moyenne'), description: t('Deux fois plus lente · 1 à 4 s.'), value: 'medium' },
  { label: t('Lente'), description: t('Trois fois plus lente · 1,5 à 6 s.'), value: 'slow' },
])
const renderer = terminalRenderer
const width = contentWidth
const widthItems = computed(() => [
  { label: t('Normale'), description: t('Colonne de 760 px · terminal ajusté.'), value: 'normal' },
  { label: t('Large'), description: t('Jusqu’à 1100 px · terminal ajusté.'), value: 'wide' },
  { label: t('Pleine largeur'), description: t('Toute la largeur, terminal compris.'), value: 'full' },
])
const quotaMode = quotaDisplay
const quotaItems = computed(() => [
  { label: t('Restant'), description: t('Ce qu’il reste de chaque fenêtre, comme Codex.'), value: 'left' },
  { label: t('Utilisé'), description: t('Ce qui est consommé, comme Claude.'), value: 'used' },
])
const langItems = [{ label: 'English', value: 'en' }, { label: 'Français', value: 'fr' }]

// Inventaire des machines joignables ; les préférences restent propres à cet appareil.
const agentMachines = computed(() => {
  const configured = appConfig.value.machines
  return configured?.filter(m => m.local || (Boolean(m.home) && (machineInfo(m.key)?.status === 'online' || (!machineInfo(m.key) && m.online))))
    || [{ key: '', label: hostLabel.value || t('Cette machine'), kinds: appConfig.value.kinds }]
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
  return available.map(m => m.label || t('Cette machine')).join(', ')
}

// ------------------------------------------------------------ notifications
const subscribed = ref<boolean | null>(null)
const scopeItems = [
  { label: t('Coordinateurs et agents hors projet'), value: 'project_leads' },
  { label: t('Tous les agents'), value: 'all' },
]
const selectedScope = computed({
  get: () => notifyScope.value,
  set: (v: 'project_leads' | 'all') => { setNotifyScope(v).catch(e => toast((e as Error).message, true)) },
})
async function refreshPush() { subscribed.value = await pushSubscribed() }
async function pushAction() {
  if (await pushSubscribed()) await testPush()
  else await enablePush()
  refreshPush()
}
const pushNote = computed(() => t(subscribed.value
  ? 'Tu es prévenu quand un agent attend ta réponse ou a terminé.'
  : isIOS && !standalone
    ? 'Sur iPhone, ajoute d’abord l’app à l’écran d’accueil (Partager → Sur l’écran d’accueil) pour recevoir les notifications.'
    : 'Active les notifications pour être prévenu quand un agent attend ta réponse.'))

// ------------------------------------------------------------ thème
// Aperçu : fond, surface, trait, texte, accent, états (travaille, attend, fini).
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
  ? `${t('Suivre Herdr')}${followed.value ? ` · ${followed.value.label}` : ''}`
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
  ? t('Rendu actif : HTML (WebGL indisponible)')
  : terminalRenderStatus.value === 'html'
    ? t('Rendu actif : HTML')
    : t('Rendu actif : WebGL'))
watch(renderer, refreshTerminalRenderStatus)

// ------------------------------------------------------------ sécurité
const sec = ref<AuthStatus | null>(null)
const supported = import.meta.client && Boolean(window.PublicKeyCredential)
async function refreshSecurity() {
  try { sec.value = await api<AuthStatus>('/api/auth/status') }
  catch { /* hors ligne */ }
}
// Nom lisible de l'appareil, pour la liste des clés.
function deviceName() {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua) || (isIOS && !/iPhone/.test(ua))) return 'iPad'
  if (/Macintosh/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows'
  if (/Android/.test(ua)) return 'Android'
  return t('Appareil')
}
async function registerKey() {
  try {
    const bootstrapToken = sec.value?.enabled ? undefined : window.prompt(tl(
      'Jeton d’amorçage (dans les journaux du serveur)',
      'Bootstrap token (in server logs)',
    ))
    if (!sec.value?.enabled && !bootstrapToken) return
    const opts = await api<Parameters<typeof startRegistration>[0]['optionsJSON']>('/api/auth/register/options', { bootstrapToken })
    const response = await startRegistration({ optionsJSON: opts })
    await api('/api/auth/register/verify', { response, name: deviceName(), bootstrapToken })
    await start()
    toast(t('Verrouillage activé sur cet appareil ✓'))
  } catch (err) {
    const e = err as Error
    toast(e.name === 'NotAllowedError'
      ? t('Enregistrement annulé')
      : e.name === 'InvalidStateError' ? t('Cet appareil est déjà enregistré') : e.message, true)
  }
  refreshSecurity()
}
async function lockNow() {
  await api('/api/auth/lock', {}).catch(() => {})
  showLock()
}
async function disableLock() {
  if (!(await askConfirm(t('Désactiver le verrouillage ? L’app redeviendra accessible à toute personne qui peut joindre ce serveur.'), t('Désactiver')))) return
  try {
    await api('/api/auth/disable', {})
    clearOffline()
    await start()
    toast(t('Verrouillage désactivé'))
  } catch (err) { toast((err as Error).message, true) }
  refreshSecurity()
}

onMounted(() => {
  refreshTerminalRenderStatus()
  loadConfig() // thème de Herdr à jour pour « Suivre Herdr »
  refreshPush()
  refreshSecurity()
})
</script>

<template>
  <section id="settings" class="view settings-view">
    <header class="top bar settings-top">
      <UButton icon="i-lucide-chevron-left" color="neutral" variant="ghost" size="lg" class="icon-btn" :aria-label="t('Retour')" @click="back" />
      <h2>{{ desk ? t('Réglages') : activeLabel }}</h2>
    </header>
    <div class="settings-layout" :class="{ 'section-open': activeSection }">
      <nav class="settings-nav" :aria-label="t('Sections des réglages')">
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
            <h3>{{ t('Thème') }}</h3>
            <!-- Replié par défaut : on voit le thème courant, un appui déplie la liste. -->
            <button type="button" class="theme-opt theme-current" :aria-expanded="themesOpen" @click="themesOpen = !themesOpen">
              <span class="theme-sw"><i v-for="(c, i) in currentTheme ? swatches(currentTheme) : []" :key="i" :style="{ background: c }" /></span>
              <span class="theme-name">{{ currentLabel }}<small>{{ t(themesOpen ? 'Masquer les thèmes' : 'Changer de thème') }}</small></span>
              <UIcon :name="themesOpen ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="theme-check" />
            </button>
            <div v-show="themesOpen" class="theme-list" role="radiogroup" :aria-label="t('Thème')">
              <button
                type="button" role="radio" class="theme-opt" :class="{ on: themeChoice === FOLLOW_HERDR }" :aria-checked="themeChoice === FOLLOW_HERDR"
                @click="pickTheme(FOLLOW_HERDR)"
              >
                <span class="theme-sw">
                  <i v-for="(c, i) in followed ? swatches(followed) : []" :key="i" :style="{ background: c }" />
                </span>
                <span class="theme-name">{{ t('Suivre Herdr') }}<small>{{ herdrName ? `config.toml · ${herdrName}` : t('config.toml introuvable') }}</small></span>
                <UIcon v-if="themeChoice === FOLLOW_HERDR" name="i-lucide-check" class="theme-check" />
              </button>
              <button
                v-for="th in THEMES" :key="th.id" type="button" role="radio" class="theme-opt" :class="{ on: themeChoice === th.id }"
                :aria-checked="themeChoice === th.id" @click="pickTheme(th.id)"
              >
                <span class="theme-sw"><i v-for="(c, i) in swatches(th)" :key="i" :style="{ background: c }" /></span>
                <span class="theme-name">{{ th.label }}<small v-if="th.id === DEFAULT_THEME">{{ t('par défaut') }}</small><small v-else-if="th.light">{{ t('clair') }}</small></span>
                <UIcon v-if="themeChoice === th.id" name="i-lucide-check" class="theme-check" />
              </button>
            </div>
          </div>
          <p class="muted settings-hint">{{ t('Le thème est enregistré sur cet appareil.') }}</p>

          <div class="settings-group">
            <h3>{{ t('Langue') }}</h3>
            <URadioGroup v-model="lang" :items="langItems" variant="table" indicator="end" color="primary" size="lg" class="settings-radio" />
          </div>
          <p class="muted settings-hint">{{ t('La langue de l’interface est enregistrée sur cet appareil.') }}</p>

          <div class="settings-group">
            <h3>{{ t('Accueil') }}</h3>
            <label class="settings-toggle">
              <span><b>{{ t('Réorganiser automatiquement') }}</b><small>{{ t('Dans Prêts, placer les non lus avant les lus. Réglage propre à cet appareil.') }}</small></span>
              <USwitch v-model="autoReorderOn" color="success" size="xl" />
            </label>
            <label class="settings-toggle">
              <span><b>{{ t('Afficher les terminaux') }}</b><small>{{ t('Montrer les spaces de terminal dans la liste, rangés dans Prêts.') }}</small></span>
              <USwitch v-model="shellsOn" color="success" size="xl" />
            </label>
            <label class="settings-toggle">
              <span><b>{{ t('Afficher les compteurs') }}</b><small>{{ t('Afficher les compteurs d’agents sur l’accueil.') }}</small></span>
              <USwitch v-model="countersOn" color="success" size="xl" />
            </label>
            <label class="settings-toggle">
              <span><b>{{ t('Afficher les quotas') }}</b><small>{{ t('Afficher les quotas Claude et Codex sur l’accueil.') }}</small></span>
              <USwitch v-model="quotasOn" color="success" size="xl" />
            </label>
          </div>

          <div class="settings-group">
            <h3>{{ t('Quotas') }}</h3>
            <URadioGroup v-model="quotaMode" :items="quotaItems" variant="table" indicator="end" color="primary" size="lg" class="settings-radio" />
            <p class="muted settings-hint">{{ t('La couleur signale toujours un quota presque épuisé. Réglage propre à cet appareil.') }}</p>
          </div>
        </div>

        <div v-show="activeSection === 'conversation'" class="settings-section">
          <div class="settings-group settings-typing">
            <h3>{{ t('Machine à écrire') }}</h3>
            <URadioGroup v-model="typewriter" :items="typingItems" variant="table" indicator="end" color="primary" size="lg" class="settings-radio" :disabled="reducedMotion" />
            <p class="muted settings-hint">{{ t(reducedMotion ? 'Désactivée : le système demande de réduire les animations.' : 'Seules les nouvelles réponses s’écrivent ainsi ; l’historique s’affiche d’un coup. Touche une réponse en cours pour l’afficher entièrement. Réglage propre à cet appareil.') }}</p>
            <label class="settings-toggle encrypted-toggle" :class="{ 'is-disabled': !typewriterActive }">
              <span><b>{{ t('Texte chiffré') }}</b><small>{{ t('L’écriture avance en glyphes, puis le texte se déchiffre derrière.') }}</small></span>
              <USwitch v-model="encryptedOn" :disabled="!typewriterActive" color="success" size="xl" />
            </label>
            <TypingPreview v-if="activeSection === 'conversation'" />
          </div>
        </div>

        <div v-show="activeSection === 'terminal'" class="settings-section">
          <div class="settings-group">
            <h3>{{ t('Accueil') }}</h3>
            <label class="settings-toggle">
              <span><b>{{ t('Afficher les terminaux') }}</b><small>{{ t('Montrer les spaces de terminal dans la liste, rangés dans Prêts.') }}</small></span>
              <USwitch v-model="shellsOn" color="success" size="xl" />
            </label>
          </div>
          <div class="settings-group">
            <h3>{{ t('Texte') }}</h3>
            <div class="settings-stepper">
              <span>{{ t('Taille du texte du terminal') }}</span>
              <div>
                <button type="button" :aria-label="t('Réduire le texte')" @click="changeFont(-1)">A−</button>
                <output>{{ fontSize }}</output>
                <button type="button" :aria-label="t('Agrandir le texte')" @click="changeFont(1)">A+</button>
              </div>
            </div>
          </div>
          <div class="settings-group settings-renderer">
            <h3>{{ t('Rendu du terminal') }}</h3>
            <URadioGroup v-model="renderer" :items="rendererItems" variant="table" indicator="end" color="primary" size="lg" class="settings-radio" />
            <p class="muted settings-hint">{{ t('Le rendu est enregistré sur cet appareil.') }}</p>
            <p class="settings-renderer-status" role="status">{{ rendererStatus }}</p>
          </div>
        </div>

        <div v-show="activeSection === 'agents'" class="settings-section">
          <div class="settings-group">
            <h3>{{ t('Nouvel agent') }}</h3>
            <p class="muted agent-pref-intro">{{ t('Types proposés dans Nouvel agent. Le terminal reste toujours disponible.') }}</p>
            <div v-if="installedAgents.length" class="agent-pref-list">
              <label v-for="agent in installedAgents" :key="agent" class="settings-toggle">
                <span><b>{{ kindLabel(agent) }}</b><small v-if="agentMachineHint(agent)">{{ agentMachineHint(agent) }}</small></span>
                <input class="agent-pref-check" type="checkbox" :checked="agentChecked(agent)" @change="setAgentChecked(agent, ($event.target as HTMLInputElement).checked)">
              </label>
            </div>
            <p v-else class="muted agent-pref-intro">{{ t('Aucun agent installé sur les machines en ligne.') }}</p>
            <p class="muted agent-pref-note">{{ t('Choix enregistrés sur cet appareil.') }}</p>
          </div>
          <WorktreesSection />
        </div>

        <div v-show="activeSection === 'notifications'" class="settings-section">
          <div class="settings-group">
            <div class="settings-card">
              <button type="button" class="settings-action" @click="pushAction">
                <UIcon name="i-lucide-bell" />{{ t(subscribed ? 'Envoyer une notification de test' : 'Activer les notifications') }}
              </button>
              <p class="muted">{{ pushNote }}</p>
            </div>
            <p class="notify-caption">{{ t('Notifier pour') }}</p>
            <URadioGroup v-model="selectedScope" :items="scopeItems" variant="table" indicator="end" color="primary" size="lg" class="settings-radio" />
            <p class="muted notify-hint">{{ t('Les threads de projet restent visibles et leurs messages non lus sont conservés.') }}</p>
          </div>
        </div>

        <div v-show="activeSection === 'security'" class="settings-section">
          <div class="settings-group">
            <h3>{{ t('Clé d’accès') }}</h3>
            <div class="settings-card">
              <template v-if="sec && !sec.enabled">
                <button type="button" class="settings-action" :disabled="!supported" @click="registerKey">
                  <UIcon name="i-lucide-lock" />{{ t('Activer le verrouillage par clé d’accès') }}
                </button>
                <p class="muted">{{ t(supported ? 'Sans verrouillage, toute personne qui peut joindre ce serveur peut piloter tes agents. Clé d’accès : Face ID, Touch ID, Windows Hello…' : 'Ce navigateur ne gère pas les clés d’accès.') }}</p>
              </template>
              <template v-else-if="sec">
                <p class="muted keys">{{ t('Clés enregistrées :') }} {{ sec.devices.map(d => d.name).join(', ') }}</p>
                <button type="button" class="settings-action" @click="registerKey"><UIcon name="i-lucide-plus" />{{ t('Ajouter cet appareil') }}</button>
                <button type="button" class="settings-action" @click="lockNow"><UIcon name="i-lucide-lock" />{{ t('Verrouiller maintenant') }}</button>
                <button type="button" class="settings-action danger" @click="disableLock"><UIcon name="i-lucide-lock-open" />{{ t('Désactiver le verrouillage') }}</button>
                <p class="muted">{{ hostLabel ? tl(`Le déverrouillage dure 12 h. Clé perdue : supprimer data/auth.json sur ${hostLabel}.`, `Unlocking lasts 12 h. Lost key: delete data/auth.json on ${hostLabel}.`) : tl('Le déverrouillage dure 12 h. Clé perdue : supprimer data/auth.json sur le serveur.', 'Unlocking lasts 12 h. Lost key: delete data/auth.json on the server.') }}</p>
              </template>
            </div>
          </div>
        </div>

        <!-- Mise en page ordinateur seulement (même seuil que l'app : 900 px). -->
        <div v-if="desk" v-show="activeSection === 'desktop'" class="settings-section">
          <div class="settings-group settings-width">
            <h3>{{ t('Largeur du contenu') }}</h3>
            <URadioGroup v-model="width" :items="widthItems" variant="table" indicator="end" color="primary" size="lg" class="settings-radio" />
            <p class="muted settings-hint">{{ t('Conversation, terminal, réglages et autres contenus. Réglage propre à cet appareil.') }}</p>
          </div>
        </div>

        <div v-show="activeSection === 'about'" class="settings-section">
          <div class="settings-group">
            <h3>{{ t('Application') }}</h3>
            <p class="settings-version">wherdr · v{{ appVersion }}</p>
            <button type="button" class="settings-action solo" @click="reloadApp"><UIcon name="i-lucide-refresh-cw" />{{ t('Recharger l’app') }}</button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script lang="ts">
function reloadApp() { location.reload() }
</script>
