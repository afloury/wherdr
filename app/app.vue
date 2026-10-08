<script setup lang="ts">
// Shell: agent list (sidebar on a computer) + current page
// (agent, settings), windows, lock screen, network banner.
import { en, fr } from '@nuxt/ui/locale'

setToaster(useToast())
const route = useRoute()
const router = useRouter()
const isHome = computed(() => route.path === '/' || route.path === '')
const searchOpen = ref(false)
function openSearch() { searchOpen.value = true }

useHead({
  htmlAttrs: { lang: language, class: computed(() => (activeTheme.value.def.light ? 'light' : 'dark')) },
  meta: [
    { name: 'description', content: tl('Control your Herdr code agents', 'Piloter ses agents de code Herdr') },
    { key: 'theme-color', name: 'theme-color', content: themeColor },
    { key: 'color-scheme', name: 'color-scheme', content: computed(() => (activeTheme.value.def.light ? 'light' : 'dark')) },
  ],
  link: [{ rel: 'manifest', href: language === 'en' ? '/manifest-en.webmanifest' : '/manifest.webmanifest' }],
})

function onVisibility() {
  pageVisible.value = !document.hidden
  sendViewing()
  // iOS freezes the page in the background and cuts the sockets: we reconnect on return.
  if (!document.hidden) connectEvents()
  // Back in the foreground: the server may end a session past its maximum duration.
  if (!document.hidden && !locked.value) {
    if (mayReadOffline(readOfflineAccess())) confirmLock({ resume: true })
    else start({ resume: true })
  }
}
// Keyboard shortcuts (computer): utils/shortcuts.ts, composables/useShortcuts.ts.
useShortcuts(searchOpen)

// File dropped outside a drop zone: the browser would open it instead
// of the app. The zones (agent view) take it first; here, we refuse the rest.
function blockFileDrop(e: DragEvent) {
  if (!carriesFiles(e.dataTransfer) || e.defaultPrevented) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'
}

// Keyboard (computer): Escape closes the open window (handled by the modals).
onMounted(() => {
  installViewport()
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('dragover', blockFileDrop)
  window.addEventListener('drop', blockFileDrop)
  registerServiceWorker()
  if ('serviceWorker' in navigator) {
    // A tap on a notification while the app is open: the SW asks us to go there.
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'navigate' && e.data.url) {
        const hash = new URL(e.data.url, location.href).hash
        router.push(hash.replace(/^#/, '') || '/')
      }
    })
  }
  start({ resume: true })
  // First launch: the setup guide, until finished or skipped (saved by the server).
  watch(locked, (l) => { if (!l) checkOnboarding() }, { immediate: true })
  // Local lease over: ask the server (which slides an active session) rather
  // than locking on the browser's own clock. Only the sliding lease counts here:
  // the maximum duration never locks the app while it is open.
  leaseTimer = setInterval(() => {
    const access = readOfflineAccess()
    if (access?.enabled && !mayReadOffline({ enabled: true, expiresAt: access.expiresAt }) && !locked.value) start()
  }, 30000)
})
let leaseTimer: ReturnType<typeof setInterval> | undefined
onUnmounted(() => {
  document.removeEventListener('visibilitychange', onVisibility)
  window.removeEventListener('dragover', blockFileDrop)
  window.removeEventListener('drop', blockFileDrop)
  clearInterval(leaseTimer)
})
</script>

<template>
  <UApp :locale="language === 'fr' ? fr : en" :toaster="{ position: desk ? 'top-right' : 'top-center', max: 1, progress: false }">
    <HomeView v-show="desk || isHome" @search="openSearch" />
    <GlobalSearch v-model:open="searchOpen" />
    <NuxtPage />
    <NewAgentSheet />
    <MenuSheet />
    <RenameSheet />
    <CommandResultSheet />
    <ConfirmSheet />
    <PluginInputSheet />
    <PluginResultSheet />
    <ImageLightbox />
    <ShortcutsSheet />
    <OnboardingGuide v-if="onboardingOpen && !locked" />
    <NewVersionBanner v-if="!locked" />
    <SelfUpdateScreen v-if="selfUpdate.open" />
    <LockScreen v-if="locked" />
  </UApp>
</template>
