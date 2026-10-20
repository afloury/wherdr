<script setup lang="ts">
import { longPress } from '~/utils/longPress'

defineProps<{ text: string }>()
const open = ref(false)
let held = false
const press = longPress({ onPress: () => { held = true; open.value = true } })
function down(e: PointerEvent) { held = false; press.down(e) }
function up() {
  if (held) press.suppressClick()
  press.cancel()
}
function click(e: MouseEvent) {
  if (press.swallowClick()) { e.preventDefault(); e.stopPropagation() }
}
onBeforeUnmount(press.cancel)
</script>

<template>
  <UTooltip v-model:open="open" :text="text" :content="{ side: 'bottom' }" :ui="{ content: 'coordinator-tooltip' }">
    <span class="coordinator-hint" tabindex="0" :aria-label="text" @pointerdown="down" @pointermove="press.move" @pointerup="up" @pointercancel="press.cancel" @pointerleave="press.cancel" @click.capture="click" @contextmenu.prevent>
      <slot />
    </span>
  </UTooltip>
</template>
