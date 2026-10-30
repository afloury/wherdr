<script setup lang="ts">
import type { VirtualModifier } from '~/utils/terminalModifiers'
import { displayVirtualChord } from '~/utils/keybarKeys'

const props = defineProps<{ ctl: TerminalCtl, allDigits?: boolean, terminal?: boolean }>()
const emit = defineEmits<{ keyboard: [] }>()
const modifiers: { key: VirtualModifier, label: string }[] = [
  { key: 'alt', label: 'Alt' }, { key: 'shift', label: 'Shift' },
]
const nav = [
  { key: 'left', icon: 'i-lucide-arrow-left', label: () => tl('Left arrow', 'Flèche gauche') },
  { key: 'up', icon: 'i-lucide-arrow-up', label: () => tl('Up arrow', 'Flèche haut') },
  { key: 'down', icon: 'i-lucide-arrow-down', label: () => tl('Down arrow', 'Flèche bas') },
  { key: 'right', icon: 'i-lucide-arrow-right', label: () => tl('Right arrow', 'Flèche droite') },
  { key: 'enter', icon: 'i-lucide-corner-down-left', label: () => tl('Enter', 'Entrée') },
]
const terminalKeys = [
  { key: 'home', label: () => tl('Home', 'Début') }, { key: 'end', label: () => tl('End', 'Fin') },
  { key: 'pageup', label: () => tl('PgUp', 'Page précédente') }, { key: 'pagedown', label: () => tl('PgDn', 'Page suivante') },
  { key: 'delete', label: () => tl('Delete', 'Supprimer') }, { key: 'insert', label: () => tl('Insert', 'Insérer') },
]
const remaining = ['y', 'n', ...Array.from({ length: 12 }, (_, i) => `f${i + 1}`)]
const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']
const active = computed(() => props.ctl.virtualModifiers.value)
const preview = computed(() => active.value.length
  ? `${displayVirtualChord(active.value.join('+'))} + …`
  : props.ctl.lastVirtualChord.value || t('One-shot chord'))
function modifier(key: VirtualModifier) { haptic(); props.ctl.toggleVirtualModifier(key) }
function press(key: string) { haptic(); void props.ctl.sendVirtualKey(key) }
function toggleKbd() {
  if (!props.terminal) { emit('keyboard'); return }
  if (props.ctl.hasFocus()) props.ctl.blur()
  else props.ctl.focus()
}
</script>

<template>
  <div class="keybar virtual-keyboard" role="group" :aria-label="t('Terminal function keys')">
    <output class="vk-announcement" aria-live="polite">{{ preview }}</output>
    <div class="vk-strip" role="toolbar" :aria-label="t('Common keys and modifiers')">
      <button type="button" :class="{ selected: terminal && ctl.kbdOn.value }" :aria-label="t('Show or hide the phone keyboard')" @pointerdown.prevent @click="toggleKbd"><UIcon name="i-lucide-keyboard" mode="svg" /></button>
      <button type="button" class="vk-mod" :class="{ selected: active.includes('ctrl') }" :aria-pressed="active.includes('ctrl')" :aria-label="t('Ctrl')" @pointerdown.prevent @click="modifier('ctrl')">{{ t('Ctrl') }}</button>
      <button type="button" :aria-label="t('Esc')" @pointerdown.prevent @click="press('esc')">{{ t('Esc') }}</button>
      <button type="button" :aria-label="tl('Tab', 'Tabulation')" @pointerdown.prevent @click="press('tab')">{{ tl('Tab', 'Tab') }}</button>
      <button v-for="k in nav" :key="k.key" type="button" :aria-label="k.label()" @pointerdown.prevent @click="press(k.key)"><UIcon :name="k.icon" mode="svg" class="vk-key-icon" aria-hidden="true" /></button>
      <button type="button" class="danger" :aria-label="tl('Ctrl+C', 'Ctrl+C')" @pointerdown.prevent @click="press('ctrl+c')">^C</button>
      <button type="button" :aria-label="tl('Backspace', 'Retour arrière')" @pointerdown.prevent @click="press('backspace')"><UIcon name="i-lucide-delete" mode="svg" class="vk-key-icon" aria-hidden="true" /></button>
      <button v-for="k in terminalKeys" :key="k.key" type="button" :aria-label="k.label()" @pointerdown.prevent @click="press(k.key)">{{ k.label() }}</button>
      <button v-for="m in modifiers" :key="m.key" type="button" class="vk-mod" :class="{ selected: active.includes(m.key) }" :aria-pressed="active.includes(m.key)" :aria-label="t(m.label)" @pointerdown.prevent @click="modifier(m.key)">{{ t(m.label) }}</button>
      <button v-for="key in remaining" :key="key" type="button" :aria-label="key.toUpperCase()" @pointerdown.prevent @click="press(key)">{{ key.toUpperCase() }}</button>
      <template v-if="allDigits"><button v-for="d in digits" :key="d" type="button" :aria-label="d" @pointerdown.prevent @click="press(d)">{{ d }}</button></template>
    </div>
  </div>
</template>

<style scoped>
.keybar.virtual-keyboard { display: block; flex: none; padding: 0 0 5px; border: 0; background: transparent; background-image: none; overflow: visible; }
.keybar.virtual-keyboard::before { content: none; }
.vk-strip { display: flex; gap: 6px; padding: 4px 11px; overflow-x: auto; scrollbar-width: none; overscroll-behavior-x: contain; }
.vk-strip::-webkit-scrollbar { display: none; }
.virtual-keyboard button { position: relative; display: grid; place-items: center; flex: none; min-width: 38px; height: 36px; margin: 0; padding: 0 3px; border: 1px solid var(--line-soft); border-radius: 0; background: var(--bg-2); color: var(--text-2); font: 500 12px/1 var(--mono); user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; touch-action: manipulation; }
.virtual-keyboard button::after { content: ''; position: absolute; top: -5px; bottom: -5px; left: -4px; right: -4px; }
.virtual-keyboard button.selected { border-color: var(--accent); color: var(--accent); }
.virtual-keyboard button:active { background: var(--surface-3); }
.virtual-keyboard button.danger { color: var(--rose); border-color: var(--rose); }
.virtual-keyboard .vk-key-icon { width: 19px; height: 19px; flex: none; }
.vk-announcement { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
</style>
