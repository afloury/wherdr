<script setup lang="ts">
// A made-up wherdr conversation that plays in a loop (~14 s) inside the hero
// phone, in the app's own look (Titanium theme, fonts, bubbles, omp console):
// a message is typed and queued, then sent; the agent works in its console
// (actions `❯` pile up under the gliding ring), answers in typewriter +
// encrypted text, and asks a question with numbered answers; one is picked,
// and it starts over. Sized in `--u` = one iPhone point (390 pt wide screen).
// Plays only on screen in a visible tab; prefers-reduced-motion shows the
// final state, still.

const MESSAGE = 'Cache getUser, and clear the entry when a user changes.'
const ACTIONS = [
  { tool: 'read', arg: 'src/users.js' },
  { tool: 'grep', arg: '"getUser" src/' },
  { tool: 'edit', arg: 'src/users.js  +18 −3' },
  { tool: 'bash', arg: 'npm test  ✓ 14 passed' },
]
const ANSWER = 'getUser now keeps users in a cache with an expiry, and updateUser clears the entry, so reads never return stale data.'
const OPTIONS = [
  { n: 1, title: '1 minute', sub: 'Fresh data, more database reads' },
  { n: 2, title: '5 minutes', sub: 'Balanced' },
  { n: 3, title: '15 minutes', sub: 'Fewest reads' },
]

// Steps: 1 typing · 2 queued · 3 sent · 4–7 actions · 8 answer · 9 your turn · 10 picked · 11 fade.
const TIMELINE: [number, number][] = [
  [700, 1], [2500, 2], [3300, 3], [3800, 4], [4450, 5], [5100, 6], [5750, 7],
  [6500, 8], [8700, 9], [10600, 10], [13300, 11],
]
const LOOP = 14000
const FINAL = 10

const step = ref(0)
const loop = ref(0)
const typed = ref('')
const root = ref<HTMLElement | null>(null)

const actions = computed(() => ACTIONS.slice(0, Math.max(0, Math.min(ACTIONS.length, step.value - 3))))
const status = computed(() =>
  step.value >= 9 ? { label: 'your turn', cls: 'turn' } : step.value >= 3 ? { label: 'working', cls: 'work' } : { label: 'ready', cls: 'ready' })
const composer = computed(() => (step.value === 1 ? typed.value : ''))

let timers: ReturnType<typeof setTimeout>[] = []
let typing: ReturnType<typeof setInterval> | undefined
let io: IntersectionObserver | undefined
let onScreen = false
let running = false

function stop() {
  for (const t of timers) clearTimeout(t)
  timers = []
  clearInterval(typing)
  running = false
}

function typeMessage() {
  typed.value = ''
  let i = 0
  clearInterval(typing)
  typing = setInterval(() => {
    i += 2
    typed.value = MESSAGE.slice(0, i)
    if (i >= MESSAGE.length) clearInterval(typing)
  }, 1500 / (MESSAGE.length / 2))
}

function run() {
  stop()
  running = true
  step.value = 0
  loop.value++
  for (const [at, s] of TIMELINE) {
    timers.push(setTimeout(() => {
      step.value = s
      if (s === 1) typeMessage()
    }, at))
  }
  timers.push(setTimeout(run, LOOP))
}

function sync() {
  const active = onScreen && !document.hidden
  if (active && !running) run()
  else if (!active && running) stop()
}

onMounted(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    step.value = FINAL
    return
  }
  document.addEventListener('visibilitychange', sync)
  io = new IntersectionObserver(([e]) => { onScreen = !!e?.isIntersecting; sync() })
  if (root.value) io.observe(root.value)
})
onBeforeUnmount(() => {
  stop()
  io?.disconnect()
  document.removeEventListener('visibilitychange', sync)
})
</script>

<template>
  <div ref="root" class="pd" aria-hidden="true">
    <header class="top">
      <UIcon name="i-lucide-chevron-left" class="ic back" />
      <div class="who">
        <div class="name">acme-api</div>
        <div class="state" :class="status.cls"><i class="sq" />{{ status.label }} <span class="dimmed">· omp</span></div>
      </div>
      <div class="tools">
        <UIcon name="i-lucide-plus" class="ic" />
        <UIcon name="i-lucide-square-terminal" class="ic" />
        <UIcon name="i-lucide-search" class="ic" />
      </div>
    </header>

    <div class="body" :class="{ fade: step >= 11 }">
      <div class="msg agent old">
        <p>The tests pass on main. Tell me what to change next.</p>
        <div class="meta"><UIcon name="i-lucide-copy" class="mi" /> ✓ 1 min · 2 actions</div>
      </div>

      <div v-if="step >= 2" :key="`u${loop}`" class="msg user rise">
        <div class="bubble">{{ MESSAGE }}</div>
        <div class="meta right" :class="{ queued: step < 3 }">{{ step < 3 ? 'Queued · sending…' : 'Sent · read by the agent' }}</div>
      </div>

      <div v-if="step >= 4" :key="`c${loop}`" class="console fx-ring rise">
        <div class="console-head">
          <UIcon name="i-herdr-omp" class="omp" />
          <span>omp</span>
          <span class="dimmed">· {{ actions.length }} action{{ actions.length > 1 ? 's' : '' }}</span>
          <span v-if="step < 8" class="spin">●</span>
        </div>
        <div v-for="a in actions" :key="a.tool" class="act rise">
          <span class="caret">❯</span> <b>{{ a.tool }}</b> <span class="arg">{{ a.arg }}</span>
        </div>
      </div>

      <div v-if="step >= 8" :key="`a${loop}`" class="msg agent rise">
        <p><EncryptedText :text="ANSWER" :duration="1700" /></p>
      </div>

      <div v-if="step >= 9" :key="`t${loop}`" class="turn-card rise">
        <div class="turn-label"><i class="sq" /> Your turn</div>
        <div class="q">Which cache lifetime should getUser use?</div>
        <div class="opts">
          <div v-for="o in OPTIONS" :key="o.n" class="opt" :class="{ picked: step >= 10 && o.n === 2 }">
            <span class="num">{{ o.n }}</span>
            <span><span class="ot">{{ o.title }}</span><span class="os">{{ o.sub }}</span></span>
          </div>
        </div>
      </div>
    </div>

    <footer class="composer">
      <div class="field">
        <span v-if="composer">{{ composer }}<i class="caret-bar" /></span>
        <span v-else class="ph">{{ step >= 9 ? 'Type a reply…' : 'Message to omp…' }}</span>
      </div>
      <div class="row">
        <span class="plus"><UIcon name="i-lucide-plus" class="mi" /></span>
        <span class="pick">GPT-5.5 <UIcon name="i-lucide-chevron-down" class="mi" /></span>
        <span class="pick">high <UIcon name="i-lucide-chevron-down" class="mi" /></span>
        <span class="send" :class="{ on: composer }"><UIcon name="i-lucide-arrow-up" class="mi" /></span>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.pd {
  --u: calc(100cqw / 390);
  position: absolute; inset: 0; display: flex; flex-direction: column;
  background: var(--bg); color: var(--text); font: calc(var(--u) * 16) / 1.45 var(--sans);
  text-align: left; user-select: none;
}
.ic { width: calc(var(--u) * 24); height: calc(var(--u) * 24); color: var(--text); }
.mi { width: calc(var(--u) * 14); height: calc(var(--u) * 14); vertical-align: -.15em; }
.dimmed { color: var(--dim); }
.sq { display: inline-block; width: calc(var(--u) * 9); height: calc(var(--u) * 9); margin-right: calc(var(--u) * 6); background: currentColor; }

/* ------------------------------------------------------------ header */
.top {
  display: flex; align-items: center; gap: calc(var(--u) * 12);
  height: calc(var(--u) * 58); padding: 0 calc(var(--u) * 16); flex: none;
  border-bottom: 1px solid var(--line);
}
.who { flex: 1; min-width: 0; }
.name { font: 700 calc(var(--u) * 19) / 1.1 var(--sans); color: #fff; }
.state { font: 500 calc(var(--u) * 13) / 1.4 var(--mono); transition: color .3s; }
.state.ready { color: var(--green); }
.state.work { color: var(--accent); }
.state.turn { color: var(--amber); }
.tools { display: flex; gap: calc(var(--u) * 18); }

/* -------------------------------------------------------------- body */
.body {
  flex: 1; min-height: 0; overflow: hidden;
  display: flex; flex-direction: column; justify-content: flex-end; gap: calc(var(--u) * 14);
  padding: calc(var(--u) * 14) calc(var(--u) * 16);
  transition: opacity .6s ease;
}
.body.fade { opacity: 0; }
@keyframes rise { from { opacity: 0; transform: translateY(calc(var(--u) * 10)); } }
.rise { animation: rise .35s cubic-bezier(.2, .7, .2, 1) both; }

.msg p { margin: 0; }
.old { color: var(--muted); }
.meta { margin-top: calc(var(--u) * 6); font: calc(var(--u) * 12) / 1.3 var(--mono); color: var(--dim); }
.meta.right { text-align: right; }
.meta.queued { color: var(--amber); }
.user { display: flex; flex-direction: column; align-items: flex-end; }
.bubble {
  max-width: 82%; padding: calc(var(--u) * 10) calc(var(--u) * 14);
  background: var(--surface-2); border: 1px solid var(--line-strong); color: var(--text);
}

/* omp console: actions under the gliding ring. */
.console {
  --fx-fill: var(--bg-2); --fx-speed: 6s;
  padding: calc(var(--u) * 10) calc(var(--u) * 12);
  font: calc(var(--u) * 13) / 1.55 var(--mono);
}
.console-head { display: flex; align-items: center; gap: calc(var(--u) * 6); margin-bottom: calc(var(--u) * 4); font-size: calc(var(--u) * 11); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.omp { width: calc(var(--u) * 15); height: calc(var(--u) * 15); }
@keyframes pulse { 50% { opacity: .25; } }
.spin { margin-left: auto; color: var(--accent); animation: pulse 1s ease-in-out infinite; }
.act { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--muted); }
.act b { color: var(--text); font-weight: 600; }
.caret { color: var(--omp); }
.arg { color: var(--dim); }

/* Your turn card. */
.turn-card {
  margin: 0 calc(var(--u) * -16); padding: calc(var(--u) * 12) calc(var(--u) * 16) 0;
  border-top: 1px solid color-mix(in srgb, var(--rose) 45%, var(--line));
  background: linear-gradient(color-mix(in srgb, var(--rose) 7%, var(--bg)), var(--bg));
}
.turn-label { display: flex; align-items: center; font: 600 calc(var(--u) * 12) / 1 var(--mono); letter-spacing: .14em; text-transform: uppercase; color: var(--rose); }
.q { margin: calc(var(--u) * 8) 0 calc(var(--u) * 10); font-weight: 700; color: #fff; }
.opts { border: 1px solid var(--line); }
.opt { display: flex; gap: calc(var(--u) * 16); padding: calc(var(--u) * 9) calc(var(--u) * 14); border-bottom: 1px solid var(--line); background: var(--bg-2); transition: background .25s, box-shadow .25s; }
.opt:last-child { border-bottom: 0; }
.opt .num { font: 600 calc(var(--u) * 13) / 1.6 var(--mono); color: var(--rose); }
.ot { display: block; color: var(--text); }
.os { display: block; font-size: calc(var(--u) * 13); color: var(--muted); }
.opt.picked { background: color-mix(in srgb, var(--accent) 14%, var(--bg-2)); box-shadow: inset 0 0 0 1px var(--accent); }
.opt.picked .num { color: var(--accent); }

/* ---------------------------------------------------------- composer */
.composer { flex: none; padding: calc(var(--u) * 8) calc(var(--u) * 12) calc(var(--u) * 26); }
.field {
  min-height: calc(var(--u) * 50); padding: calc(var(--u) * 12) calc(var(--u) * 14) calc(var(--u) * 6);
  border: 1px solid var(--line-strong); border-bottom: 0; background: var(--bg-2);
  font-size: calc(var(--u) * 15); line-height: 1.35;
}
.ph { color: var(--dim); }
.caret-bar { display: inline-block; width: 1px; height: 1.1em; margin-left: 1px; vertical-align: -.2em; background: var(--accent); }
.row {
  display: flex; align-items: center; gap: calc(var(--u) * 12);
  padding: calc(var(--u) * 6) calc(var(--u) * 8) calc(var(--u) * 8);
  border: 1px solid var(--line-strong); border-top: 0; background: var(--bg-2);
  font: 600 calc(var(--u) * 13) / 1 var(--mono); color: var(--muted);
}
.plus { display: grid; place-items: center; width: calc(var(--u) * 32); height: calc(var(--u) * 32); border: 1px solid var(--line-strong); color: var(--text); }
.pick { display: inline-flex; align-items: center; gap: calc(var(--u) * 4); }
.send { display: grid; place-items: center; margin-left: auto; width: calc(var(--u) * 32); height: calc(var(--u) * 32); background: var(--surface-2); color: var(--dim); transition: background .2s, color .2s; }
.send.on { background: var(--accent); color: var(--on-accent); }
</style>
