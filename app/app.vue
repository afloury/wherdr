<script setup lang="ts">
// Coquille : liste des agents (barre latérale sur ordinateur) + page courante
// (agent, réglages), fenêtres, écran de verrouillage, bandeau réseau.
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
    { name: 'description', content: tl('Piloter ses agents de code Herdr', 'Control your Herdr code agents') },
    { key: 'theme-color', name: 'theme-color', content: themeColor },
    { key: 'color-scheme', name: 'color-scheme', content: computed(() => (activeTheme.value.def.light ? 'light' : 'dark')) },
  ],
  link: [{ rel: 'manifest', href: language === 'en' ? '/manifest-en.webmanifest' : '/manifest.webmanifest' }],
})

function onVisibility() {
  pageVisible.value = !document.hidden
  sendViewing()
  // iOS gèle la page en arrière-plan et coupe les sockets : on se reconnecte au retour.
  if (!document.hidden) connectEvents()
  if (!document.hidden && !locked.value && !mayReadOffline(readOfflineAccess())) start()
}
function onShortcut(e: KeyboardEvent) {
  if (!locked.value && swapShortcut(e)) return
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    if (!locked.value) searchOpen.value = !searchOpen.value
  }
}

// Clavier (ordinateur) : Échap ferme la fenêtre ouverte (géré par les modales).
onMounted(() => {
  installViewport()
  document.addEventListener('visibilitychange', onVisibility)
  document.addEventListener('keydown', onShortcut)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
    // Un tap sur une notif alors que l'app est ouverte : le SW nous demande d'y aller.
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'navigate' && e.data.url) {
        const hash = new URL(e.data.url, location.href).hash
        router.push(hash.replace(/^#/, '') || '/')
      }
    })
  }
  start()
  leaseTimer = setInterval(() => {
    const access = readOfflineAccess()
    if (access?.enabled && !mayReadOffline(access) && !locked.value) showLock()
  }, 30000)
})
let leaseTimer: ReturnType<typeof setInterval> | undefined
onUnmounted(() => {
  document.removeEventListener('visibilitychange', onVisibility)
  document.removeEventListener('keydown', onShortcut)
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
    <ImageLightbox />
    <LockScreen v-if="locked" />
  </UApp>
</template>
