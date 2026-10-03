<script setup lang="ts">
// One omp tool call, drawn after omp's own terminal: bash is "$ command" in
// mono with its intent underneath, the other tools their title and target
// ("Grep  pattern · 95 matches · in server"). Wall time on the right, ⚠ on
// an error, and the end of the output (or an edit's diff) unfolds on a tap.
// While it runs: omp's braille spinner and the intent it gave for the call.
//
// TEMPORARY (design proposals): `ompToolStyle` picks one of four other
// drawings, all in the vocabulary of omp's activity line (braille, │ rules,
// mono segments, omp's color):
//   a  activity line: each call is a line of that family
//   b  tree: ├─ └─ connectors, mono tool badge, intent, then ⎿ target
//   c  segments: a strip of 1 px segments, like omp's status line
//   d  terminal frame: the group is a console (see ChatView), "❯ command"
import type { ChatItem, OmpToolView } from '#shared/types'
import { ompEarlier, ompToolGlyph, ompToolMeta, ompWall } from '~/utils/ompTool'
import { ompCommandLine, ompKind, ompToolStyle } from '~/utils/ompToolStyle'

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

const style = computed(() => ompToolStyle.value)
// Running call: its start, for the elapsed time next to the spinner.
const since = computed(() => (props.live && props.tool.ts ? Date.parse(props.tool.ts) || null : null))
const intent = computed(() => v.value.intent || v.value.title)
const kind = computed(() => ompKind(v.value.title))
const cmdLine = computed(() => ompCommandLine(v.value.title, v.value.target))
// Exit code and job go to the status part; the counts stay with the target.
const counts = computed(() => meta.value.filter(m => !/^Exit: /.test(m)))
const exit = computed(() => v.value.exit ? String(v.value.exit) : '')
const toggle = () => { if (canOpen.value) open.value = !open.value }
</script>

<template>
  <div
    v-if="style === '0'" class="omp-tool" :class="{ bash, err, live, open, foldable: canOpen }"
    :title="!bash && v.intent ? v.intent : undefined"
  >
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

  <div v-else class="ot" :class="[`ot-${style}`, { bash, err, live, open, foldable: canOpen }]">
    <component
      :is="canOpen ? 'button' : 'div'" class="ot-head" :type="canOpen ? 'button' : undefined"
      :aria-expanded="canOpen ? open : undefined" @click="toggle"
    >
      <!-- a: "⠿ Intent │ $ command │ counts │ 0.11s", omp's activity line. -->
      <template v-if="style === 'a'">
        <span class="ot-glyph" aria-hidden="true">
          <OmpSpinner v-if="live" />
          <template v-else>{{ err ? '✗' : '⠿' }}</template>
        </span>
        <UChatShimmer v-if="live" :text="intent" :duration="2.4" class="ot-intent" />
        <span v-else class="ot-intent">{{ intent }}</span>
        <span class="ot-tail">
          <code v-if="v.target" class="ot-seg ot-target"><span class="ot-sign">{{ bash ? '$' : v.title.toLowerCase() }}</span> {{ v.target }}</code>
          <span v-for="(m, i) in counts" :key="i" class="ot-seg ot-count">{{ m }}</span>
          <span v-if="exit" class="ot-seg ot-exit">exit {{ exit }}</span>
        </span>
        <span v-if="live && since" class="ot-seg ot-wall"><OmpElapsed :since="since" /></span>
        <span v-else-if="wall" class="ot-seg ot-wall">{{ wall }}</span>
      </template>

      <!-- b: tree connector (CSS), [BASH] badge, intent; ⎿ target underneath. -->
      <template v-else-if="style === 'b'">
        <span class="ot-main">
          <span class="ot-line1">
            <span class="ot-badge"><OmpSpinner v-if="live" /><span v-else-if="err" aria-hidden="true">✗</span><span>{{ kind }}</span></span>
            <UChatShimmer v-if="live" :text="intent" :duration="2.4" class="ot-intent" />
            <span v-else class="ot-intent">{{ intent }}</span>
            <span v-if="live && since" class="ot-wall"><OmpElapsed :since="since" /></span>
            <span v-else-if="wall" class="ot-wall">{{ wall }}</span>
          </span>
          <span v-if="v.target || meta.length" class="ot-line2">
            <span class="ot-elbow" aria-hidden="true">╰</span>
            <code v-if="v.target" class="ot-target"><span v-if="bash" class="ot-sign">$ </span>{{ v.target }}</code>
            <span v-for="(m, i) in counts" :key="i" class="ot-count">{{ m }}</span>
            <span v-if="exit" class="ot-count ot-exit">exit {{ exit }}</span>
          </span>
        </span>
      </template>

      <!-- c: a strip of segments, "▶ BASH │ intent │ target │ 0.11s ✓". -->
      <template v-else-if="style === 'c'">
        <span class="ot-kind"><OmpSpinner v-if="live" /><template v-else>{{ err ? '✗' : '▶' }}</template> {{ kind }}</span>
        <UChatShimmer v-if="live" :text="intent" :duration="2.4" class="ot-intent" />
        <span v-else class="ot-intent">{{ intent }}</span>
        <span class="ot-tail">
          <code v-if="v.target" class="ot-target"><span v-if="bash" class="ot-sign">$ </span>{{ v.target }}</code>
          <span v-for="(m, i) in counts" :key="i" class="ot-count">{{ m }}</span>
          <span v-if="exit" class="ot-count ot-exit">exit {{ exit }}</span>
        </span>
        <span v-if="live && since" class="ot-wall"><OmpElapsed :since="since" /></span>
        <span v-else-if="wall" class="ot-wall">{{ wall }} <span class="ot-ok" aria-hidden="true">{{ err ? '✗' : '✓' }}</span></span>
      </template>

      <!-- d: a console line, "❯ command  0.11s", then "# intent ⎿ counts". -->
      <template v-else>
        <span class="ot-line1">
          <span class="ot-glyph" aria-hidden="true"><OmpSpinner v-if="live" /><template v-else>{{ err ? '✗' : '❯' }}</template></span>
          <code class="ot-cmd">{{ cmdLine }}</code>
          <span v-if="live && since" class="ot-wall"><OmpElapsed :since="since" /></span>
          <span v-else-if="wall" class="ot-wall">{{ wall }}</span>
        </span>
        <span class="ot-line2">
          <UChatShimmer v-if="live" :text="`# ${intent}`" :duration="2.4" class="ot-intent" />
          <span v-else-if="v.intent" class="ot-intent"># {{ v.intent }}</span>
          <span v-if="counts.length || exit" class="ot-result">→ {{ counts.join(' · ') }}<template v-if="exit"><template v-if="counts.length"> · </template><span class="ot-exit">exit {{ exit }}</span></template></span>
        </span>
      </template>
    </component>

    <!-- Unfolded output: a framed block with omp's header (OUTPUT / DIFF, wall, exit). -->
    <div v-if="canOpen && open" class="ot-out">
      <div class="ot-out-head">
        <span>{{ v.diff ? 'Diff' : err ? tl('Error', 'Erreur') : 'Output' }}</span>
        <span v-if="earlier">{{ tl(`… ${earlier} earlier lines`, `… ${earlier} lignes avant`) }}</span>
        <span class="ot-out-right">
          <span v-if="exit" class="ot-exit">exit {{ exit }}</span>
          <span v-if="wall">[wall {{ wall }}]</span>
        </span>
      </div>
      <pre><span v-for="(l, i) in outLines" :key="i" :class="l.cls">{{ l.text }}
</span></pre>
    </div>
  </div>
</template>
