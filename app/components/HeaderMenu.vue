<script setup lang="ts">
// Header (space, tab, pane cell): right click (computer) or long
// press (phone, tablet) = the same menu as its "…" button: at the pointer with a
// mouse, as the bottom sheet on a touch or narrow screen (`sheetMenus`). The menu
// stays on screen and closes with Escape, an outside click or scrolling. The
// fields, the terminal and the text keep the browser's native menu.
import { longPress } from '~/utils/longPress'
import { keepsNativeMenu, skipsPress } from '~/utils/headerMenu'

const props = defineProps<{ items: () => MenuItem[], title?: string, disabled?: boolean, manualPress?: boolean }>()
const dropdown = ref<ReturnType<typeof toDropdown>>([])

// Scrolling: Reka does not close the menu, we simulate Escape.
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
let pointerType = ''
// Native menu kept: we stop the event before Reka's trigger.
function onContext(e: MouseEvent) {
  if (keepsNativeMenu(e.target as Element | null)) e.stopPropagation()
  else if (sheetMenus.value) {
    e.preventDefault()
    // Right click with a mouse (narrow window, tablet trackpad): the sheet.
    if (pointerType === 'mouse' && !props.disabled) openMenu(props.items(), props.title)
  }
}

const lp = longPress({
  onPress: () => {
    haptic()
    openMenu(props.items(), props.title)
  },
})
function down(e: PointerEvent) {
  pointerType = e.pointerType
  // `manualPress`: the parent handles the long press (plan drag and drop).
  if (!sheetMenus.value || props.disabled || props.manualPress || skipsPress(e.target as Element | null)) return
  lp.down(e)
}
</script>

<template>
  <UContextMenu :disabled="sheetMenus || disabled" :items="dropdown" :ui="{ content: 'hw-dropdown' }" @update:open="onOpen">
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
