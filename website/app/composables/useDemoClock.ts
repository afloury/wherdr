import type { Ref } from 'vue'
import type { DemoScript } from '~/utils/demoScript'

// One clock per demo script, shared by every view that plays it (the hero's
// phone and desktop use the same one, so they show the same moment and never
// drift). Each view registers its root element; the loop plays while at least
// one of them is on screen in a visible tab, and prefers-reduced-motion pins
// the script's final state. Clocks are module-level on purpose: they are only
// written in the browser (the server renders step 0).

type Clock = {
  step: Ref<number>
  loop: Ref<number>
  typed: Ref<string>
  views: Set<Element>
  onScreen: Set<Element>
  io?: IntersectionObserver
  timers: number[]
  typing?: number
  running: boolean
  sync: () => void
}

const clocks = new Map<string, Clock>()

function stop(c: Clock) {
  for (const t of c.timers) clearTimeout(t)
  c.timers = []
  clearInterval(c.typing)
  c.running = false
}

function run(c: Clock, script: DemoScript) {
  stop(c)
  c.running = true
  c.step.value = 0
  c.typed.value = ''
  c.loop.value++
  for (const [at, s] of script.timeline) {
    c.timers.push(window.setTimeout(() => {
      c.step.value = s
      const t = script.typing
      if (t?.step !== s) return
      let i = 0
      clearInterval(c.typing)
      c.typing = window.setInterval(() => {
        i += 2
        c.typed.value = t.text.slice(0, i)
        if (i >= t.text.length) clearInterval(c.typing)
      }, t.ms / (t.text.length / 2))
    }, at))
  }
  c.timers.push(window.setTimeout(() => run(c, script), script.loop))
}

function clockFor(script: DemoScript) {
  let c = clocks.get(script.id)
  if (!c) {
    const clock: Clock = {
      step: ref(0), loop: ref(0), typed: ref(''),
      views: new Set(), onScreen: new Set(), timers: [], running: false,
      sync: () => {
        const active = clock.onScreen.size > 0 && !document.hidden
        if (active && !clock.running) run(clock, script)
        else if (!active && clock.running) stop(clock)
      },
    }
    c = clock
    clocks.set(script.id, c)
  }
  return c
}

/** Plays `script` while `root` (or another view of the same script) is visible. */
export function useDemoClock(script: DemoScript, root: Ref<HTMLElement | null>) {
  const c = clockFor(script)

  onMounted(() => {
    const el = root.value
    if (!el) return
    if (!c.views.size) {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        c.step.value = script.final
        c.typed.value = script.typing?.text ?? ''
      }
      else {
        document.addEventListener('visibilitychange', c.sync)
        c.io = new IntersectionObserver((entries) => {
          for (const e of entries) {
            if (e.isIntersecting) c.onScreen.add(e.target)
            else c.onScreen.delete(e.target)
          }
          c.sync()
        })
      }
    }
    c.views.add(el)
    c.io?.observe(el)
  })

  onBeforeUnmount(() => {
    const el = root.value
    if (!el || !c.views.delete(el)) return
    c.io?.unobserve(el)
    c.onScreen.delete(el)
    if (c.views.size) return c.sync()
    stop(c)
    c.io?.disconnect()
    c.io = undefined
    document.removeEventListener('visibilitychange', c.sync)
    c.step.value = 0
  })

  return { step: readonly(c.step), loop: readonly(c.loop), typed: readonly(c.typed) }
}
