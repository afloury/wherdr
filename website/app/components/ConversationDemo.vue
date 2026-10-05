<script setup lang="ts">
// Story 1.1 on /preview: a Claude Code conversation on a computer. The
// grouped tool calls unfold, the effort picker goes from medium to high, the
// command the agent proposes is copied, then run: the view flips to the live
// terminal (xterm look), the tests pass, and it flips back. CONVERSATION script.
import { CONVERSATION, CONVERSATION_TOOLS, EFFORTS, TEST_OUTPUT } from '~/utils/storyDemos'
import type { DemoAgent } from '~/utils/demoScript'

const root = ref<HTMLElement | null>(null)
const { step, typed } = useDemoClock(CONVERSATION, root)

const terminal = computed(() => step.value >= 7 && step.value < 10)
const running = computed(() => step.value >= 6 && step.value < 9)
const agents = computed<DemoAgent[]>(() => [
  { name: 'web-shop', icon: 'i-herdr-claude-code', model: 'opus 5.5 ' + (step.value >= 3 ? 'high' : 'medium'), state: running.value ? 'work' : 'ready', line: running.value ? '❯ bash npm test' : 'I added a small cart module and three tests.' },
  { name: 'acme-api', icon: 'i-herdr-omp', model: 'GPT-5.5 high', state: 'work', line: '❯ edit src/users.js' },
  { name: 'docs-site', icon: 'i-herdr-codex', model: 'gpt-5.5 medium', state: 'ready', line: 'The changelog for 2.4 is written. Anything else?' },
])
</script>

<template>
  <div ref="root" class="cd" aria-hidden="true">
    <DemoDesktop :width="1200" :agents="agents" active="web-shop" :terminal="terminal" :title="{ name: 'web-shop', state: running ? 'work' : 'ready', sub: 'claude · Cart module and tests · ~/projects/web-shop' }">
      <div v-if="terminal" class="term demo-rise">
        <div class="tl"><span class="p">~/projects/web-shop $</span> {{ step === 7 ? typed : 'npm test' }}<i v-if="step === 7" class="cur" /></div>
        <template v-if="step >= 8">
          <div class="tl dim">&gt; web-shop@1.0.0 test</div>
          <div class="tl dim">&gt; node --test src/</div>
          <div v-for="l in TEST_OUTPUT" :key="l" class="tl demo-rise"><span class="ok">ok</span>{{ l.slice(2) }}</div>
        </template>
        <template v-if="step >= 9">
          <div class="tl demo-rise"># tests 3 · <span class="ok">pass 3</span> · fail 0</div>
          <div class="tl"><span class="p">~/projects/web-shop $</span> <i class="cur" /></div>
        </template>
      </div>
      <div v-else class="body">
        <DemoUserMessage text="Add a cart module with tests." />
        <div class="msg">
          <p>I'll add <code>src/cart.js</code> with pure functions, then replace the placeholder with tests.</p>
          <div class="group" :class="{ open: step >= 1 }">
            <div class="ghead"><UIcon :name="step >= 1 ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="demo-mi" /> 3 actions <span class="demo-dim">· Write, Command</span></div>
            <template v-if="step >= 1">
              <div v-for="t in CONVERSATION_TOOLS" :key="t.arg" class="tool demo-rise"><UIcon :name="t.icon" class="demo-mi" /> <b>{{ t.tool }}</b> <span class="demo-dim">{{ t.arg }}</span></div>
            </template>
          </div>
          <p>I added a small cart module in <code>src/cart.js</code> and three tests. Run them with:</p>
          <div class="code">
            <div class="chead">
              <span>bash</span>
              <span class="cbtn" :class="{ hit: step === 5 }"><UIcon :name="step >= 5 ? 'i-lucide-check' : 'i-lucide-copy'" class="demo-mi" /> {{ step >= 5 ? 'Copied' : 'Copy' }}</span>
              <span class="cbtn run" :class="{ hit: step === 6 }"><UIcon name="i-lucide-play" class="demo-mi" /> Run</span>
            </div>
            <pre>npm test</pre>
          </div>
          <div class="meta"><UIcon name="i-lucide-copy" class="demo-mi" /> ↩ Reply · ✓ 2 min 40 s · 3 actions</div>
        </div>
        <p v-if="step >= 10" class="msg demo-rise">All three tests pass in the terminal.</p>
      </div>
      <DemoComposer v-if="!terminal" desktop placeholder="Message to Claude…" model="Opus 5.5" :effort="step >= 3 ? 'high' : 'medium'" :menu="step >= 2 && step < 4 ? EFFORTS : undefined" />
    </DemoDesktop>
  </div>
</template>

<style scoped>
.cd { position: absolute; inset: 0; }
.body { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; justify-content: flex-end; gap: calc(var(--u) * 16); padding: calc(var(--u) * 20) 0; }
.msg p { margin: 0 0 calc(var(--u) * 12); }
code { padding: 0 calc(var(--u) * 5); border-left: 1px solid var(--line-strong); background: var(--surface); font: calc(var(--u) * 14) var(--mono); color: var(--accent); }
.group { margin: 0 0 calc(var(--u) * 14); padding: calc(var(--u) * 8) calc(var(--u) * 14); border-left: 1px solid var(--line-strong); font-size: calc(var(--u) * 15); }
.ghead { display: flex; align-items: center; gap: calc(var(--u) * 6); font: 600 calc(var(--u) * 12) / 1.8 var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.tool { display: flex; align-items: center; gap: calc(var(--u) * 8); line-height: 2; color: var(--muted); }
.tool b { font-weight: 500; color: var(--text); }
.tool .demo-dim { font: calc(var(--u) * 13) var(--mono); }
.code { border: 1px solid var(--line-strong); background: var(--bg-2); }
.chead { display: flex; align-items: center; gap: calc(var(--u) * 16); padding: calc(var(--u) * 8) calc(var(--u) * 14); border-bottom: 1px solid var(--line); font: 600 calc(var(--u) * 11) / 1 var(--mono); letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
.chead > span:first-child { flex: 1; }
.cbtn { display: inline-flex; align-items: center; gap: calc(var(--u) * 5); padding: calc(var(--u) * 5) calc(var(--u) * 8); transition: background .2s, color .2s; }
.cbtn.run { color: var(--accent); }
.cbtn.hit { background: var(--accent); color: var(--on-accent); }
pre { margin: 0; padding: calc(var(--u) * 12) calc(var(--u) * 14); font: calc(var(--u) * 14) / 1.6 var(--mono); color: var(--text); }
.meta { margin-top: calc(var(--u) * 10); font: calc(var(--u) * 12) / 1.3 var(--mono); color: var(--dim); }

/* Live terminal, xterm look. */
.term { flex: 1; min-height: 0; margin: calc(var(--u) * 16) 0; padding: calc(var(--u) * 14) calc(var(--u) * 16); background: #0a0c10; border: 1px solid var(--line); font: calc(var(--u) * 14) / 1.6 var(--mono); color: #d4d8e0; overflow: hidden; }
.tl { white-space: pre; }
.p { color: var(--green); }
.ok { color: var(--green); }
.dim { color: var(--dim); }
.cur { display: inline-block; width: .6em; height: 1.1em; vertical-align: -.18em; background: #d4d8e0; animation: blink 1.1s steps(1) infinite; }
</style>
