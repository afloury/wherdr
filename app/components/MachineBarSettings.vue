<script setup lang="ts">
// Settings › Appearance › Machine bar: show the bar or not, the order of its
// items (drag the ⠿ handle, or arrow keys on it) and which ones it shows. A
// machine taken off the bar still shows under "All". Kept on this device
// (composables/useMachineBar.ts).
import type { MachineInfo } from '#shared/types'
import { BAR_ALL, moveBarItem, setBarItemShown } from '~/utils/machineBar'

onMounted(loadMachineOrder)

const barOn = machineBarOn
const list = ref<HTMLElement | null>(null)
// While dragging: the item, how far the pointer went, where it would land and
// each row's height (the others make room by that much).
const drag = ref<{ id: string, from: number, dy: number, to: number, h: number } | null>(null)

const STATE: Record<MachineInfo['status'], string> = { online: 'online', connecting: 'reconnecting…', offline: 'offline' }
function statusOf(id: string): MachineInfo['status'] {
  const mine = machines.value.filter(m => (m.baseKey ?? m.key) === id)
  // A single machine Herdr's state does not list: online while Herdr answers.
  if (!mine.length) return herdrState.value.ok ? 'online' : 'offline'
  return mine.some(m => m.status === 'online') ? 'online' : mine.some(m => m.status === 'connecting') ? 'connecting' : 'offline'
}
const rows = computed(() => {
  return machineBarItems.value.map(x => ({
    ...x,
    label: x.id === BAR_ALL ? t('All') : machineName(machines.value.find(m => (m.baseKey ?? m.key) === x.id)?.key ?? x.id) || x.id || hostLabel.value || 'herdr',
    status: x.id === BAR_ALL ? null : statusOf(x.id),
  }))
})
const ids = () => machineBarItems.value.map(x => x.id)
const isDefault = computed(() => !machineBarOrder.value.length && !machineBarHidden.value.length)

function setShown(id: string, shown: boolean) {
  machineBarHidden.value = setBarItemShown(machineBarHidden.value, id, shown)
}
function move(id: string, to: number) {
  const next = moveBarItem(ids(), id, to)
  if (next.join('\n') !== ids().join('\n')) machineBarOrder.value = next
}
function onKey(id: string, e: KeyboardEvent) {
  const at = ids().indexOf(id)
  if (e.key === 'ArrowUp' && at > 0) move(id, at - 1)
  else if (e.key === 'ArrowDown' && at < ids().length - 1) move(id, at + 2)
  else return
  e.preventDefault()
  haptic()
  nextTick(() => list.value?.querySelector<HTMLElement>(`[data-bar-id="${CSS.escape(id)}"] .bar-pref-grip`)?.focus())
}

// Drag by the handle (mouse, finger, pen): the row follows the pointer, the
// others make room, and the order is saved on release. The rows keep their
// place in the page until then (transforms only).
function shift(i: number) {
  const d = drag.value
  if (!d) return undefined
  if (i === d.from) return `translateY(${d.dy}px)`
  if (d.from < i && i <= d.to) return `translateY(${-d.h}px)`
  if (d.to <= i && i < d.from) return `translateY(${d.h}px)`
  return undefined
}
function blockScroll(e: TouchEvent) { if (drag.value) e.preventDefault() }
let release: (() => void) | null = null
onBeforeUnmount(() => release?.())
function onGrab(id: string, e: PointerEvent) {
  if (drag.value || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return
  e.preventDefault()
  const els = [...(list.value?.querySelectorAll<HTMLElement>('[data-bar-id]') || [])]
  const from = els.findIndex(el => el.dataset.barId === id)
  if (from < 0) return
  // Middles of the rows where they stand now.
  const mids = els.map((el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2 })
  const h = els[from]!.getBoundingClientRect().height
  const y0 = e.clientY
  drag.value = { id, from, dy: 0, to: from, h }
  haptic()
  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId || !drag.value) return
    const dy = ev.clientY - y0
    const y = mids[from]! + dy
    // Final place: the number of other rows whose middle is above the row's middle.
    const to = mids.filter((m, i) => i !== from && m < y).length
    if (to !== drag.value.to) haptic()
    drag.value = { ...drag.value, dy, to }
  }
  const end = (save: boolean) => (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return
    const d = drag.value
    release?.()
    if (save && d && d.to !== d.from) move(id, d.to > d.from ? d.to + 1 : d.to)
  }
  release = () => {
    release = null
    drag.value = null
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', cancel)
    document.removeEventListener('touchmove', blockScroll)
  }
  const up = end(true)
  const cancel = end(false)
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', cancel)
  // iOS: the page stays still while the row moves.
  document.addEventListener('touchmove', blockScroll, { passive: false })
}
</script>

<template>
  <!-- Inside the Home screen group (Settings › Appearance › Home screen). -->
  <div class="machine-bar-settings">
    <h4 class="theme-section-title bar-pref-title">{{ tl('Machine bar', 'Barre des machines') }}</h4>
    <label class="settings-toggle">
      <span><b>{{ tl('Show the machine bar', 'Afficher la barre des machines') }}</b><small>{{ tl('At the top of the home screen: “All”, then each machine. A tap shows that machine only.', 'En haut de l’accueil : « Toutes », puis chaque machine. Un toucher n’affiche que cette machine.') }}</small></span>
      <USwitch v-model="barOn" color="success" size="xl" />
    </label>
    <template v-if="barOn">
      <p class="bar-pref-head">{{ tl('Order and display', 'Ordre et affichage') }}</p>
      <ul ref="list" class="bar-pref-list" :class="{ dragging: drag }">
        <li v-for="(r, i) in rows" :key="r.id" class="bar-pref-row" :class="{ moving: drag?.id === r.id, off: !r.shown }" :style="{ transform: shift(i) }" :data-bar-id="r.id">
          <button
            type="button" class="bar-pref-grip" :aria-label="tl(`Move ${r.label} — up and down arrows`, `Déplacer ${r.label} — flèches haut et bas`)"
            :title="t('Drag to reorder')" @pointerdown="onGrab(r.id, $event)" @keydown="onKey(r.id, $event)"
          >⠿</button>
          <label class="bar-pref-label">
            <input class="agent-pref-check" type="checkbox" :checked="r.shown" @change="setShown(r.id, ($event.target as HTMLInputElement).checked)">
            <i v-if="r.status" class="bar-pref-state" :class="r.status" :title="t(STATE[r.status])" aria-hidden="true" />
            <span>{{ r.label }}</span>
            <small v-if="r.status && r.status !== 'online'">{{ t(STATE[r.status]) }}</small>
          </label>
        </li>
      </ul>
      <UButton color="neutral" variant="outline" icon="i-lucide-rotate-ccw" class="bar-pref-reset" :disabled="isDefault" @click="resetMachineBar">
        {{ tl('Reset: All + every machine', 'Rétablir : Toutes + toutes les machines') }}
      </UButton>
    </template>
    <p class="muted settings-hint">{{ t('Choices saved on this device.') }}</p>
  </div>
</template>
