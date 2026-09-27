<script setup lang="ts">
// Barre de touches : touches logiques, encodées par Herdr selon le mode du
// terminal (curseur applicatif, etc.). Ne vole pas le focus au champ de saisie.
const props = defineProps<{ ctl: TerminalCtl }>()

const KEYS: { key: string, label: string, cls?: string }[] = [
  { key: 'esc', label: 'esc' }, { key: 'enter', label: '⏎', cls: 'wide' }, { key: 'up', label: '↑' }, { key: 'down', label: '↓' },
  { key: '1', label: '1' }, { key: '2', label: '2' }, { key: '3', label: '3' }, { key: 'tab', label: 'tab' },
  { key: 'shift+tab', label: '⇧tab' }, { key: 'left', label: '←' }, { key: 'right', label: '→' },
  { key: 'ctrl+c', label: '^C', cls: 'danger' }, { key: 'backspace', label: '⌫' }, { key: 'y', label: 'y' }, { key: 'n', label: 'n' },
]

function press(key: string) {
  haptic()
  props.ctl.sendKeys([key])
}
function toggleKbd() {
  if (props.ctl.hasFocus()) props.ctl.blur()
  else props.ctl.focus()
}
</script>

<template>
  <div class="keybar" role="toolbar" :aria-label="t('Touches')">
    <button v-for="k in KEYS" :key="k.key" type="button" :class="k.cls" @pointerdown.prevent @click="press(k.key)">{{ k.label }}</button>
    <button type="button" class="kbd" :class="{ on: ctl.kbdOn.value }" :aria-label="t('Taper dans le terminal')" @pointerdown.prevent @click="toggleKbd">
      <UIcon name="i-lucide-keyboard" />
    </button>
  </div>
</template>
