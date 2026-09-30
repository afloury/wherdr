<script setup lang="ts">
// En-tête (space, onglet, case de pane) : clic droit (ordinateur) ou appui
// long (téléphone) = le même menu que son bouton « … », au pointeur. Le menu
// reste dans l'écran et se ferme à Échap, clic dehors ou défilement. Les
// champs, le terminal et le texte gardent le menu natif du navigateur.
import { longPress } from '~/utils/longPress'
import { keepsNativeMenu, skipsPress } from '~/utils/headerMenu'

const props = defineProps<{ items: () => MenuItem[], title?: string, disabled?: boolean, press?: boolean }>()
const dropdown = ref<ReturnType<typeof toDropdown>>([])

// Défilement : Reka ne ferme pas le menu, on simule Échap.
function onScroll() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
}
function onOpen(o: boolean) {
  if (o) {
    dropdown.value = toDropdown(props.items())
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
  } else window.removeEventListener('scroll', onScroll, { capture: true })
}
onUnmounted(() => window.removeEventListener('scroll', onScroll, { capture: true }))
// Menu natif gardé : on arrête l'événement avant le déclencheur de Reka.
function onContext(e: MouseEvent) {
  if (keepsNativeMenu(e.target as Element | null)) e.stopPropagation()
  else if (!desk.value) e.preventDefault()
}

const lp = longPress({
  onPress: () => {
    haptic()
    openMenu(props.items(), props.title)
  },
})
function down(e: PointerEvent) {
  // `press: false` : le parent gère l'appui long (glisser-déposer du plan).
  if (desk.value || props.disabled || props.press === false || skipsPress(e.target as Element | null)) return
  lp.down(e)
}
</script>

<template>
  <UContextMenu :disabled="!desk || disabled" :items="dropdown" :ui="{ content: 'hw-dropdown' }" @update:open="onOpen">
    <div
      class="header-menu" @contextmenu.capture="onContext" @pointerdown="down" @pointermove="lp.move"
      @pointerup="lp.cancel" @pointercancel="lp.cancel"
    >
      <slot />
    </div>
  </UContextMenu>
</template>

<style scoped>
.header-menu { display: contents; }
</style>
