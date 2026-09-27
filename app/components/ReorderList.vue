<script setup lang="ts">
// Liste de cartes d'un groupe (même machine, même état) que l'on réordonne par
// glisser-déposer, comme les espaces de la barre latérale de Herdr : souris
// (bouton appuyé, puis glisser), ou appui long puis glisser au doigt. L'ordre
// d'un groupe est celui de Herdr ; le déplacement part vers la machine de
// l'espace (shared/spaces.ts, reorderTarget), sans focus.
// Au doigt : avant l'appui long, le geste reste un défilement ; un appui long
// immobile ouvre toujours le menu de la carte (700 ms).
import { reorderTarget } from '#shared/spaces'

const props = defineProps<{ disabled?: boolean }>()

const HOLD = 300 // ms : appui long avant de pouvoir glisser (le menu vient à 700)
const MOUSE_SLOP = 5
const SCROLL_SLOP = 8
const EDGE = 56 // px : bande de défilement automatique en haut et en bas

const list = ref<HTMLElement | null>(null)
const line = ref<{ top: number } | null>(null)
const dragging = ref(false)

interface Drag {
  card: HTMLElement
  id: string
  pointer: number
  touch: boolean
  x0: number
  y0: number
  y: number
  armed: boolean
  active: boolean
  timer: number
  ghost: HTMLElement | null
  dy: number
  slot: number
  scroller: HTMLElement | null
  raf: number
}
let d: Drag | null = null

const cards = () => (list.value ? [...list.value.querySelectorAll<HTMLElement>(':scope > .card[data-ws]')] : [])
const menuOpen = () => Boolean(document.querySelector('[role="menu"][data-state="open"]'))

function onDown(e: PointerEvent) {
  if (props.disabled || d || !e.isPrimary) return
  if (e.pointerType === 'mouse' && e.button !== 0) return
  const target = e.target as HTMLElement
  // Réponses en un tap : ce sont des boutons, pas une poignée.
  if (target.closest('button, a, input, textarea')) return
  const card = target.closest<HTMLElement>('.card[data-ws]')
  if (!card || card.parentElement !== list.value || cards().length < 2) return
  const touch = e.pointerType !== 'mouse'
  d = {
    card, id: card.dataset.ws!, pointer: e.pointerId, touch, x0: e.clientX, y0: e.clientY, y: e.clientY,
    armed: !touch, active: false, timer: 0, ghost: null, dy: 0, slot: -1,
    scroller: card.closest<HTMLElement>('.scroll'), raf: 0,
  }
  if (touch) {
    d.timer = window.setTimeout(() => {
      if (!d || d.active) return
      d.armed = true
      card.classList.add('reorder-armed')
      haptic()
    }, HOLD)
    // Seul moyen d'empêcher le défilement d'iOS une fois la carte saisie.
    document.addEventListener('touchmove', blockScroll, { passive: false })
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', cancel)
}

function blockScroll(e: TouchEvent) {
  if (d && (d.armed || d.active)) e.preventDefault()
}

function onMove(e: PointerEvent) {
  if (!d || e.pointerId !== d.pointer) return
  d.y = e.clientY
  const dist = Math.hypot(e.clientX - d.x0, e.clientY - d.y0)
  if (!d.active) {
    // Au doigt, bouger avant l'appui long : c'est un défilement.
    if (!d.armed) { if (dist > SCROLL_SLOP) cancel(); return }
    if (dist < (d.touch ? 2 : MOUSE_SLOP)) return
    // Le menu de la carte s'est ouvert (appui immobile) : il a la main.
    if (menuOpen()) return cancel()
    start()
  }
  // Pas de preventDefault ici : le menu de la carte doit voir ce mouvement
  // pour annuler son appui long.
  place()
}

function start() {
  if (!d) return
  d.active = true
  dragging.value = true
  const r = d.card.getBoundingClientRect()
  d.dy = d.y0 - r.top
  const g = d.card.cloneNode(true) as HTMLElement
  g.classList.remove('reorder-armed', 'sel')
  g.classList.add('reorder-ghost')
  g.removeAttribute('data-ws')
  g.setAttribute('aria-hidden', 'true')
  // Dans la liste, sous le trait de dépôt (qui reste visible).
  Object.assign(g.style, { width: `${r.width}px`, left: `${r.left - list.value!.getBoundingClientRect().left}px` })
  list.value!.appendChild(g)
  d.ghost = g
  d.card.classList.remove('reorder-armed')
  d.card.classList.add('reorder-source')
  document.documentElement.classList.add('reordering')
  if (!d.touch) haptic()
  tick()
}

// Interstice visé : avant la première carte dont le milieu est sous le doigt.
function place() {
  if (!d || !list.value) return
  const all = cards()
  const top = list.value.getBoundingClientRect().top
  let slot = all.length
  for (let i = 0; i < all.length; i++) {
    const r = all[i]!.getBoundingClientRect()
    if (d.y < r.top + r.height / 2) { slot = i; break }
  }
  const from = all.indexOf(d.card)
  if (slot !== d.slot) {
    d.slot = slot
    if (slot !== -1 && slot !== from && slot !== from + 1 && d.touch) haptic()
  }
  // Trait de dépôt : entre deux cartes, rien là où la carte est déjà.
  if (slot === from || slot === from + 1) line.value = null
  else {
    const edge = slot < all.length ? all[slot]!.getBoundingClientRect().top : all[all.length - 1]!.getBoundingClientRect().bottom
    line.value = { top: edge - top }
  }
  if (d.ghost) d.ghost.style.top = `${d.y - d.dy - top}px`
}

// Défilement automatique près des bords de la liste qui défile.
function tick() {
  if (!d || !d.active) return
  const s = d.scroller
  if (s) {
    const r = s.getBoundingClientRect()
    const v = d.y < r.top + EDGE ? -(r.top + EDGE - d.y) : d.y > r.bottom - EDGE ? d.y - (r.bottom - EDGE) : 0
    if (v) {
      s.scrollTop += Math.max(-18, Math.min(18, v / 3))
      place()
    }
  }
  d.raf = requestAnimationFrame(tick)
}

function onUp(e: PointerEvent) {
  if (!d || e.pointerId !== d.pointer) return
  const drop = d.active ? { id: d.id, slot: d.slot } : null
  const all = cards()
  if (drop) {
    // Un clic suit le relâchement de la souris : il n'ouvre pas la carte.
    window.addEventListener('click', swallow, { capture: true, once: true })
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)
  }
  cancel()
  if (!drop || drop.slot < 0) return
  const group = all.map(c => c.dataset.ws!)
  const machine = herdrState.value.workspaces.find(w => w.id === drop.id)?.machine || ''
  const order = herdrState.value.workspaces.filter(w => (w.machine || '') === machine).sort((a, b) => a.number - b.number).map(w => w.id)
  const to = reorderTarget(order, group, drop.id, drop.slot)
  if (to) moveWorkspace(drop.id, to.before)
}

function swallow(e: Event) {
  e.stopPropagation()
  e.preventDefault()
}

function cancel() {
  if (!d) return
  window.clearTimeout(d.timer)
  cancelAnimationFrame(d.raf)
  d.ghost?.remove()
  d.card.classList.remove('reorder-armed', 'reorder-source')
  document.documentElement.classList.remove('reordering')
  document.removeEventListener('touchmove', blockScroll)
  window.removeEventListener('pointermove', onMove)
  window.removeEventListener('pointerup', onUp)
  window.removeEventListener('pointercancel', cancel)
  d = null
  line.value = null
  dragging.value = false
}

onBeforeUnmount(cancel)
</script>

<template>
  <div ref="list" class="card-list reorder-list" :class="{ 'is-reordering': dragging }" @pointerdown="onDown">
    <slot />
    <div v-if="line" class="reorder-line" :style="{ top: `${line.top}px` }" aria-hidden="true" />
  </div>
</template>
