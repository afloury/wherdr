<script setup lang="ts">
// One omp tool call, drawn after omp's own terminal: bash is "$ command" in
// mono with its intent underneath, the other tools their title and target
// ("Grep  pattern · 95 matches · in server"). Wall time on the right, ⚠ on
// an error, and the end of the output (or an edit's diff) unfolds on a tap.
// While it runs: omp's braille spinner and the intent it gave for the call.
import type { ChatItem, OmpToolView } from '#shared/types'
import { ompEarlier, ompToolGlyph, ompToolMeta, ompWall } from '~/utils/ompTool'

const props = defineProps<{ tool: ChatItem & { omp: OmpToolView }, live?: boolean }>()
const open = ref(false)

const v = computed(() => props.tool.omp)
const bash = computed(() => v.value.title === 'Bash')
const err = computed(() => Boolean(props.tool.error))
const meta = computed(() => ompToolMeta(v.value))
const wall = computed(() => (props.live || v.value.ms === undefined ? '' : ompWall(v.value.ms)))
const earlier = computed(() => ompEarlier(v.value))
const canOpen = computed(() => Boolean(v.value.out))
// Under bash's command (or a tool without target): the intent. While a tool
// runs, omp shows its intent too.
const sub = computed(() => (bash.value || props.live || !v.value.target ? v.value.intent || '' : ''))
const outLines = computed(() => (v.value.out || '').split('\n').map(l => ({
  text: l,
  cls: v.value.diff ? (/^\+\s*\d*\|/.test(l) ? 'add' : /^-\s*\d*\|/.test(l) ? 'del' : '') : '',
})))
</script>

<template>
  <div class="omp-tool" :class="{ bash, err, live, open, foldable: canOpen }" :title="!bash && v.intent ? v.intent : undefined">
    <component
      :is="canOpen ? 'button' : 'div'" class="omp-tool-head" :type="canOpen ? 'button' : undefined"
      :aria-expanded="canOpen ? open : undefined" @click="canOpen && (open = !open)"
    >
      <span class="omp-tool-mark" aria-hidden="true">
        <OmpSpinner v-if="live" />
        <template v-else>{{ ompToolGlyph(v, err) }}</template>
      </span>
      <span class="omp-tool-main">
        <span class="omp-tool-line">
          <template v-if="bash && v.target"><span class="omp-tool-sign" aria-hidden="true">$</span><code class="omp-tool-cmd">{{ v.target }}</code></template>
          <template v-else>
            <b class="omp-tool-title">{{ v.title }}</b>
            <code v-if="v.target" class="omp-tool-target">{{ v.target }}</code>
          </template>
          <span v-for="(m, i) in meta" :key="i" class="omp-tool-meta">{{ m }}</span>
        </span>
        <span v-if="sub" class="omp-tool-sub">{{ sub }}</span>
      </span>
      <span v-if="wall" class="omp-tool-wall">{{ wall }}</span>
      <UIcon v-if="canOpen" :name="open ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="omp-tool-chev" />
    </component>
    <div v-if="canOpen && open" class="omp-tool-out">
      <div v-if="earlier" class="omp-tool-earlier">{{ tl(`… (${earlier} earlier lines)`, `… (${earlier} lignes avant)`) }}</div>
      <pre><span v-for="(l, i) in outLines" :key="i" :class="l.cls">{{ l.text }}
</span></pre>
    </div>
  </div>
</template>
