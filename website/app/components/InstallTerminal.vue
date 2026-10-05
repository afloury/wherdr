<script setup lang="ts">
// The install command typing itself in a small terminal, then the output of
// the real script (utils/installDemo.ts) line by line. Starts when it scrolls
// into view, can be replayed; the copy button copies the command as before.
// prefers-reduced-motion: the whole run, shown at once.
import { INSTALL_COMMAND, INSTALL_OUTPUT } from '~/utils/installDemo'

const typed = ref(INSTALL_COMMAND.length)
const shown = ref(INSTALL_OUTPUT.length)
const playing = ref(false)
const copied = ref(false)
const root = ref<HTMLElement | null>(null)
const out = ref<HTMLElement | null>(null)

let timers: ReturnType<typeof setTimeout>[] = []
let io: IntersectionObserver | undefined
let copyTimer: ReturnType<typeof setTimeout> | undefined

const later = (ms: number, fn: () => void) => { timers.push(setTimeout(fn, ms)) }

function stop() {
  for (const t of timers) clearTimeout(t)
  timers = []
  playing.value = false
}

function play() {
  stop()
  playing.value = true
  typed.value = 0
  shown.value = 0
  let at = 400
  for (let i = 1; i <= INSTALL_COMMAND.length; i++) {
    // Human-ish typing: a little faster inside words, a beat on spaces.
    at += INSTALL_COMMAND[i - 1] === ' ' ? 90 : 38 + Math.random() * 30
    later(at, () => { typed.value = i })
  }
  at += 450
  INSTALL_OUTPUT.forEach((line, i) => {
    at += line.wait
    later(at, () => {
      shown.value = i + 1
      // Keep the latest line in view inside the terminal, not the page.
      nextTick(() => { if (out.value) out.value.scrollTop = out.value.scrollHeight })
    })
  })
  later(at + 100, () => { playing.value = false })
}

async function copy() {
  try {
    await navigator.clipboard.writeText(INSTALL_COMMAND)
  } catch {
    return
  }
  copied.value = true
  clearTimeout(copyTimer)
  copyTimer = setTimeout(() => { copied.value = false }, 1800)
}

onMounted(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !root.value) return
  typed.value = 0
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
  clearTimeout(copyTimer)
})
</script>

<template>
  <div ref="root" class="term">
    <div class="bar">
      <span class="dots" aria-hidden="true"><i /><i /><i /></span>
      <span class="label">your server · sh</span>
      <span class="acts">
        <button type="button" class="act" :disabled="playing" aria-label="Replay the installation" @click="play">
          <UIcon name="i-lucide-rotate-ccw" class="size-3.5" /><span class="txt">Replay</span>
        </button>
        <button type="button" class="act" :aria-label="copied ? 'Copied' : 'Copy the install command'" @click="copy">
          <UIcon :name="copied ? 'i-lucide-check' : 'i-lucide-copy'" class="size-3.5" /><span class="txt">{{ copied ? 'Copied' : 'Copy' }}</span>
        </button>
      </span>
    </div>
    <div ref="out" class="out">
      <div class="cmdline">
        <span class="prompt" aria-hidden="true">$</span>
        <code class="cmd"><span class="sr-only">{{ INSTALL_COMMAND }}</span><span aria-hidden="true">{{ INSTALL_COMMAND.slice(0, typed) }}</span><i v-if="typed < INSTALL_COMMAND.length || (!playing && shown === 0)" class="cur" aria-hidden="true" /></code>
      </div>
      <div class="lines" aria-hidden="true">
        <div v-for="(l, i) in INSTALL_OUTPUT.slice(0, shown)" :key="i" class="ln" :class="l.kind">
          <template v-if="l.kind === 'step'"><span class="arrow">==></span> <b>{{ l.text }}</b></template>
          <template v-else-if="l.kind === 'ok'"><span class="tick">✓</span> {{ l.text }}</template>
          <template v-else-if="l.kind === 'title'"><b>wherdr</b> <span class="d">{{ l.text.replace(/^wherdr /, '') }}</span></template>
          <template v-else-if="l.kind === 'strong'"><b class="g">wherdr is running.</b> {{ l.text.replace(/^wherdr is running\. /, '') }}</template>
          <template v-else>{{ l.text || ' ' }}</template>
        </div>
        <i v-if="shown > 0 && playing" class="cur" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.term { border: 1px solid var(--line-strong); background: var(--bg-2); font-family: var(--mono); min-width: 0; }
.bar { display: flex; align-items: center; gap: 14px; height: 38px; padding: 0 0 0 14px; border-bottom: 1px solid var(--line); }
.dots { display: flex; gap: 6px; }
.dots i { width: 9px; height: 9px; border: 1px solid var(--line-strong); }
.bar .label { font-size: 10px; color: var(--dim); }
.acts { display: flex; margin-left: auto; height: 100%; }
.act {
  display: inline-flex; align-items: center; gap: 7px; padding: 0 14px; height: 100%;
  border: 0; border-left: 1px solid var(--line); background: transparent; color: var(--muted); cursor: pointer;
  font: 600 11px/1 var(--mono); letter-spacing: .1em; text-transform: uppercase;
}
.act:hover:not(:disabled) { color: var(--text); background: var(--surface); }
.act:disabled { opacity: .45; cursor: default; }
/* No ligatures: `==>` must read as the script prints it. */
.out { height: 380px; overflow-y: auto; padding: 16px 18px; font-size: 13px; line-height: 1.65; font-variant-ligatures: none; scrollbar-width: thin; }
.cmdline { display: flex; gap: 10px; }
.prompt { color: var(--green); font-weight: 600; user-select: none; }
.cmd { color: var(--text); background: none; border: 0; padding: 0; font-size: inherit; overflow-wrap: anywhere; }
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
@media (max-width: 520px) {
  .out { height: 420px; padding: 14px; font-size: 11.5px; }
  .act .txt { display: none; }
  .act { padding: 0 12px; }
}
</style>
