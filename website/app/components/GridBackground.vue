<script setup lang="ts">
// The herdr.dev background grid of the hero and the closing call to action:
// dots at the line crossings, a soft vignette, and now and then a short
// glowing dash running along a grid line, at irregular intervals, at most
// three at once. Cheap by design: CSS layers, Web Animations, timers only
// while the grid is on screen and the tab is visible. prefers-reduced-motion:
// a still grid.

// Grid cell, in CSS pixels (the 64 px tiles of .dots-grid).
const GRID_CELL = 64

const root = ref<HTMLElement | null>(null)
const packets = ref<HTMLElement | null>(null)
// Off screen or hidden tab: no new packets.
const visible = ref(false)

let io: IntersectionObserver | undefined
let reduced = false
const cleanups: (() => void)[] = []

// ---------------------------------------------------------------- packets
const MAX_PACKETS = 3
let live = 0
let spawnTimer: ReturnType<typeof setTimeout> | undefined
const rand = (a: number, b: number) => a + Math.random() * (b - a)

function spawn() {
  const box = packets.value
  if (!box || !visible.value || document.hidden || live >= MAX_PACKETS) return
  const w = box.clientWidth
  const h = box.clientHeight
  // Lines of the grid: the tiles are centred horizontally and start at the top.
  const x0 = w / 2 - GRID_CELL / 2
  const vertical = Math.random() < 0.4
  const cells = Math.round(rand(4, 9))
  const dist = cells * GRID_CELL
  const reverse = Math.random() < 0.5
  const el = document.createElement('i')
  el.className = `pkt ${vertical ? 'v' : 'h'}${reverse ? ' rev' : ''}${Math.random() < 0.3 ? ' alt' : ''}`
  if (vertical) {
    // A column near the middle, in the visible part of the fade.
    const k = Math.round(rand(-w * 0.32, w * 0.32) / GRID_CELL)
    const row = Math.round(rand(0, Math.max(1, h * 0.45 / GRID_CELL)))
    el.style.left = `${x0 + k * GRID_CELL}px`
    el.style.top = `${row * GRID_CELL}px`
  } else {
    const row = Math.round(rand(1, Math.max(2, h * 0.55 / GRID_CELL)))
    const k = Math.round(rand(-w * 0.4, w * 0.4 - dist) / GRID_CELL)
    el.style.top = `${row * GRID_CELL}px`
    el.style.left = `${x0 + k * GRID_CELL}px`
  }
  const axis = vertical ? 'Y' : 'X'
  box.appendChild(el)
  live++
  const anim = el.animate(
    [
      { transform: `translate${axis}(${reverse ? dist : 0}px)`, opacity: 0 },
      { opacity: 1, offset: 0.15 },
      { opacity: 1, offset: 0.7 },
      { transform: `translate${axis}(${reverse ? 0 : dist}px)`, opacity: 0 },
    ],
    { duration: cells * rand(300, 420), easing: 'cubic-bezier(.4, 0, .6, 1)' },
  )
  anim.onfinish = () => { el.remove(); live-- }
}

function schedulePackets() {
  clearTimeout(spawnTimer)
  if (!visible.value || document.hidden) return
  // Irregular rhythm: short bursts and long pauses, never in step.
  const wait = Math.random() < 0.25 ? rand(2600, 4200) : rand(500, 1800)
  spawnTimer = setTimeout(() => { spawn(); schedulePackets() }, wait)
}

let packetsOn = false
function setupPackets() {
  if (reduced) return
  packetsOn = true
  const onVis = () => schedulePackets()
  document.addEventListener('visibilitychange', onVis)
  cleanups.push(() => {
    packetsOn = false
    document.removeEventListener('visibilitychange', onVis)
    clearTimeout(spawnTimer)
  })
}
watch(visible, () => { if (packetsOn) schedulePackets() })

onMounted(() => {
  reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (root.value) {
    io = new IntersectionObserver(([e]) => { visible.value = !!e?.isIntersecting })
    io.observe(root.value)
  }
  setupPackets()
})
onBeforeUnmount(() => {
  io?.disconnect()
  for (const fn of cleanups) fn()
})
</script>

<template>
  <div ref="root" class="gb" aria-hidden="true">
    <div class="dots-grid" />
    <div class="vignette" />
    <div ref="packets" class="packets" />
  </div>
</template>

<style scoped>
.gb { position: absolute; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }

/* ---------------------------------------------------------- packets */
.packets {
  position: absolute; inset: 0;
  -webkit-mask: radial-gradient(ellipse 70% 60% at 50% 30%, #000 30%, transparent 75%);
  mask: radial-gradient(ellipse 70% 60% at 50% 30%, #000 30%, transparent 75%);
}
/* Same vocabulary as the packets of the flow diagram: a small glowing head,
   here with a fading 1 px trail on the line. */
.packets :deep(.pkt) { position: absolute; display: block; will-change: transform, opacity; --c: var(--accent); }
.packets :deep(.pkt.alt) { --c: var(--violet); }
.packets :deep(.pkt.h) { width: 56px; height: 1px; margin-left: -56px; background: linear-gradient(90deg, transparent, var(--c)); }
.packets :deep(.pkt.h.rev) { margin-left: 0; background: linear-gradient(270deg, transparent, var(--c)); }
.packets :deep(.pkt.h)::after { content: ''; position: absolute; right: -3px; top: -2px; width: 6px; height: 5px; background: var(--c); box-shadow: 0 0 10px var(--c); }
.packets :deep(.pkt.h.rev)::after { right: auto; left: -3px; }
.packets :deep(.pkt.v) { width: 1px; height: 56px; margin-top: -56px; background: linear-gradient(180deg, transparent, var(--c)); }
.packets :deep(.pkt.v.rev) { margin-top: 0; background: linear-gradient(0deg, transparent, var(--c)); }
.packets :deep(.pkt.v)::after { content: ''; position: absolute; left: -2px; bottom: -3px; width: 5px; height: 6px; background: var(--c); box-shadow: 0 0 10px var(--c); }
.packets :deep(.pkt.v.rev)::after { bottom: auto; top: -3px; }

/* ------------------------------------------------ dots and vignette */
.dots-grid {
  position: absolute; inset: 0;
  background-image:
    radial-gradient(circle at 32px 32px, color-mix(in srgb, var(--muted) 60%, transparent) 1.4px, transparent 2.2px),
    linear-gradient(color-mix(in srgb, var(--line) 30%, transparent) 1px, transparent 1px),
    linear-gradient(90deg, color-mix(in srgb, var(--line) 30%, transparent) 1px, transparent 1px),
    radial-gradient(ellipse 50% 40% at 50% 25%, color-mix(in srgb, var(--accent) 6%, transparent), transparent 75%);
  background-size: 64px 64px, 64px 64px, 64px 64px, 100% 100%;
  /* Dot tiles shifted half a cell: their centres land on the line crossings. */
  background-position: calc(50% - 32px) -32px, center top, center top, 0 0;
  -webkit-mask: radial-gradient(ellipse 85% 75% at 50% 35%, #000 25%, rgba(0, 0, 0, .45) 60%, transparent 88%);
  mask: radial-gradient(ellipse 85% 75% at 50% 35%, #000 25%, rgba(0, 0, 0, .45) 60%, transparent 88%);
}
/* Edges sink into the page background: depth without a blur. The top edge
   fades too, so the grid eases out of the header; above the packets so they
   fade at the edges like the dots. */
.vignette {
  position: absolute; inset: 0; z-index: 1;
  background:
    linear-gradient(to right, var(--bg), transparent 14%, transparent 86%, var(--bg)),
    linear-gradient(to bottom, var(--bg), transparent 18%, transparent 70%, var(--bg));
}
</style>
