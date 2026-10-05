<script setup lang="ts">
// An agent's reply in wherdr's conversation (ChatView.vue `msg-ai`,
// ChatMarkdown.vue). `typing`: a new reply, revealed the way the app does it
// with its default settings (medium speed, encrypted text): a writing front
// lays glyphs in the agent's color, and a second front, 40 characters
// behind, decrypts them into the text; the glyphs change every 60 ms. Text
// not reached yet is not in the page (the reply grows, as in the app), and a
// paragraph or code span appears with its first character. Timing from
// ~/utils/typing (the app's typingFronts). `code` spans are written in
// backticks; paths and commands get the app's glyph and tint (codeKind.ts).
// Without `typing`, or with prefers-reduced-motion, the reply shows at once.
import { DEFAULT_SPEED, GLYPH_MS, trailGlyphs, typingFronts } from '~/utils/typing'
import type { AgentKind } from '~/utils/demoScript'

const props = defineProps<{ paras: readonly string[], agent: AgentKind, typing?: boolean }>()

type Seg = { text: string, start: number, code: boolean, k?: 'path' | 'cmd' }
const doc = computed(() => {
  let at = 0
  return props.paras.map(p => p.split(/(`[^`]+`)/).filter(Boolean).map((s): Seg => {
    const code = s.startsWith('`')
    const text = code ? s.slice(1, -1) : s
    const seg: Seg = { text, start: at, code, k: !code ? undefined : /^(npm|git|node) /.test(text) ? 'cmd' : /[/.]/.test(text) ? 'path' : undefined }
    at += text.length
    return seg
  }))
})
const total = computed(() => doc.value.reduce((n, p) => n + p.reduce((m, s) => m + s.text.length, 0), 0))

// null = fully shown.
const fronts = ref<{ written: number, decrypted: number } | null>(props.typing ? { written: 0, decrypted: 0 } : null)
const glyphs = ref<string[]>([])
let raf = 0
onMounted(() => {
  if (!fronts.value) return
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    fronts.value = null
    return
  }
  const full = doc.value.flat().map(s => s.text).join('')
  const start = performance.now()
  let glyphAt = -Infinity
  const tick = (now: number) => {
    const f = typingFronts(total.value, now - start, DEFAULT_SPEED)
    if (f.done) {
      fronts.value = null
      return
    }
    if (now - glyphAt >= GLYPH_MS) {
      glyphs.value = trailGlyphs(full)
      glyphAt = now
    }
    fronts.value = { written: f.written, decrypted: f.decrypted }
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
})
onBeforeUnmount(() => cancelAnimationFrame(raf))

/** Per segment: decrypted text, then the cipher band [absolute index, glyph]. */
function view(s: Seg) {
  const f = fronts.value
  if (!f) return { plain: s.text, band: [] as [number, string, boolean][] }
  const dec = Math.max(0, Math.min(s.text.length, f.decrypted - s.start))
  const wr = Math.max(dec, Math.min(s.text.length, f.written - s.start))
  return {
    plain: s.text.slice(0, dec),
    band: Array.from(s.text.slice(dec, wr), (c, i): [number, string, boolean] => [s.start + dec + i, c, s.start + dec + i === f.written - 1]),
  }
}
const started = (s: Seg) => !fronts.value || fronts.value.written > s.start
</script>

<template>
  <div class="md" :class="`tw-${agent}`">
    <template v-for="(p, pi) in doc" :key="pi">
      <p v-if="started(p[0]!)">
        <template v-for="(s, si) in p" :key="si">
          <template v-if="started(s)">
            <component :is="s.code ? 'code' : 'span'" :data-k="s.k">{{ view(s).plain }}<span v-if="view(s).band.length" class="tw-trail"><span v-for="[at, c, front] in view(s).band" :key="at" :class="{ 'tw-front': front }" :data-g="glyphs[at] ?? c">{{ c }}</span></span></component>
          </template>
        </template>
      </p>
    </template>
  </div>
</template>
