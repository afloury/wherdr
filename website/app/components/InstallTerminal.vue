<script setup lang="ts">
// A macOS-style terminal window replaying an install (utils/installDemo.ts):
// each command types itself, then its output shows line by line. Starts when
// it scrolls into view (a hidden tab starts when opened) and can be replayed.
// Copying lives in the InstallCommand block above it, not here.
// prefers-reduced-motion: the whole run, shown at once.
import type { TermDemo } from '~/utils/installDemo'

const props = defineProps<{ demo: TermDemo }>()
const lines = computed(() => props.demo.lines)

// Lines fully shown, and characters typed on the command being typed.
const shown = ref(lines.value.length)
const typed = ref(0)
const playing = ref(false)
const root = ref<HTMLElement | null>(null)
const out = ref<HTMLElement | null>(null)

let timers: ReturnType<typeof setTimeout>[] = []
let io: IntersectionObserver | undefined

const later = (ms: number, fn: () => void) => { timers.push(setTimeout(fn, ms)) }
const follow = () => nextTick(() => { if (out.value) out.value.scrollTop = out.value.scrollHeight })

function stop() {
  for (const t of timers) clearTimeout(t)
  timers = []
  playing.value = false
}

function play() {
  stop()
  playing.value = true
  shown.value = 0
  typed.value = 0
  let at = 300
  lines.value.forEach((line, i) => {
    at += line.wait
    if (line.kind === 'cmd') {
      // Human-ish typing, a beat on spaces; long commands are capped so the
      // demo stays short, and `fast` ones (ssh, short commands) go quicker.
      const budget = line.fast ? 500 : 1700
      const step = Math.min(line.fast ? 30 : 45, budget / line.text.length)
      later(at, () => { shown.value = i; typed.value = 0; follow() })
      for (let c = 1; c <= line.text.length; c++) {
        at += line.text[c - 1] === ' ' ? step * 2 : step * (0.7 + Math.random() * 0.6)
        later(at, () => { typed.value = c })
      }
      at += 250
    }
    later(at, () => { shown.value = i + 1; follow() })
  })
  later(at + 100, () => { playing.value = false })
}

onMounted(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !root.value) return
  shown.value = 0
  io = new IntersectionObserver(([e]) => {
    if (!e?.isIntersecting) return
    io?.disconnect()
    play()
  }, { threshold: 0.4 })
  io.observe(root.value)
})
onBeforeUnmount(() => {
  stop()
  io?.disconnect()
})
</script>

<template>
  <div ref="root" class="term">
    <div class="bar">
      <span class="lights" aria-hidden="true"><i class="r" /><i class="y" /><i class="g" /></span>
      <span class="win-title">{{ demo.title }}</span>
      <button type="button" class="replay" :disabled="playing" aria-label="Replay the terminal demo" title="Replay" @click="play">
        <UIcon name="i-lucide-rotate-ccw" class="size-3.5" />
      </button>
    </div>
    <div ref="out" class="out">
      <!-- Screen readers get the full run at once; the animation is visual only. -->
      <div class="sr-only">
        <p v-for="(l, i) in lines" :key="i">{{ l.kind === 'cmd' ? `${l.prompt} ${l.text}` : l.text }}</p>
      </div>
      <div aria-hidden="true">
        <template v-for="(l, i) in lines.slice(0, Math.min(shown + 1, lines.length))" :key="i">
          <div v-if="l.kind === 'cmd'" class="cmdline">
            <span class="prompt">{{ l.prompt }}</span><code class="cmd">{{ i < shown ? l.text : l.text.slice(0, typed) }}<i v-if="i === shown && playing" class="cur" /></code>
          </div>
          <div v-else-if="i < shown" class="ln" :class="l.kind">
            <template v-if="l.kind === 'step'"><span class="arrow">==></span> <b>{{ l.text }}</b></template>
            <template v-else-if="l.kind === 'ok'"><span class="tick">✓</span> {{ l.text }}</template>
            <template v-else-if="l.kind === 'title'"><b>wherdr</b> <span class="d">{{ l.text.replace(/^wherdr /, '') }}</span></template>
            <template v-else-if="l.kind === 'strong' && l.text.startsWith('wherdr is running.')"><b class="g">wherdr is running.</b> {{ l.text.replace(/^wherdr is running\. /, '') }}</template>
            <template v-else-if="l.kind === 'strong'"><b class="g">{{ l.text }}</b></template>
            <template v-else>{{ l.text || ' ' }}</template>
          </div>
        </template>
        <i v-if="playing && shown < lines.length && lines[shown]?.kind !== 'cmd'" class="cur" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.term { border: 1px solid var(--line-strong); background: var(--bg-2); font-family: var(--mono); min-width: 0; }
/* macOS window bar: traffic lights left, centred title, a discreet replay icon right. */
.bar { position: relative; display: flex; align-items: center; height: 34px; padding: 0 6px 0 12px; border-bottom: 1px solid var(--line); background: var(--surface); }
.lights { display: flex; gap: 7px; flex: none; }
.lights i { width: 11px; height: 11px; border-radius: 50%; box-shadow: inset 0 0 0 .5px rgba(0, 0, 0, .35); }
.lights .r { background: #ff5f57; }
.lights .y { background: #febc2e; }
.lights .g { background: #28c840; }
.win-title { position: absolute; left: 50%; transform: translateX(-50%); max-width: calc(100% - 140px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--muted); }
.replay {
  display: grid; place-items: center; width: 26px; height: 26px; margin-left: auto;
  border: 0; background: transparent; color: var(--dim); cursor: pointer; transition: color .15s, background .15s;
}
.replay:hover:not(:disabled) { color: var(--text); background: var(--bg-2); }
.replay:focus-visible { outline: 1px solid var(--accent); }
.replay:disabled { opacity: .35; cursor: default; }
/* No ligatures: `==>` must read as the script prints it. */
.out { height: 340px; overflow-y: auto; padding: 16px 18px; font-size: 13px; line-height: 1.65; font-variant-ligatures: none; scrollbar-width: thin; }
.cmdline { overflow-wrap: anywhere; }
.prompt { margin-right: 1ch; color: var(--green); font-weight: 600; user-select: none; }
.cmd { white-space: pre-wrap; color: var(--text); background: none; border: 0; padding: 0; font-size: inherit; overflow-wrap: anywhere; }
.ln { white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text); min-height: 1.65em; }
.ln.step { margin-top: 1.65em; }
.ln.step b, .ln.title b, .ln.strong b { color: #fff; font-weight: 700; }
.arrow { color: var(--teal); }
.tick, .g { color: var(--green) !important; }
.d, .ln.dim { color: var(--dim); }
.ln.say { color: var(--muted); }
.ln.ok { padding-left: 2ch; }
@keyframes blink { 50% { opacity: 0; } }
.cur { display: inline-block; width: .55em; height: 1.1em; margin-left: 2px; vertical-align: -.2em; background: var(--accent); animation: blink 1.1s steps(1) infinite; }
/* Phone: a shorter window that scrolls inside, so the section stays compact. */
@media (max-width: 520px) {
  .out { height: 240px; padding: 12px; font-size: 11px; }
  .win-title { font-size: 11px; }
}
</style>
