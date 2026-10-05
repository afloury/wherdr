<script setup lang="ts">
// wherdr on a computer (the app's desktop layout): the agent list on the left
// (brand line, "Agents" and its buttons, Herdr session, counters, cards), the
// open agent's header (state pill · kind · title · folder, Conversation /
// Terminal tabs, +, search, menu), the reading column framed by thin lines
// (default slot, then the `bottom` slot: "Your turn", field) and an optional
// right panel (`aside` slot). Laid out for a window `width` CSS pixels wide
// (1440 by default; smaller = larger text); sets `--u` = one of those pixels.
import { KIND_LABEL } from '~/utils/demoScript'
import type { DemoAgent } from '~/utils/demoScript'

defineProps<{
  agents: readonly DemoAgent[]
  active: string
  /** Header line after the kind: conversation title, folder. */
  subtitle?: string
  where: string
  terminal?: boolean
  width?: number
}>()
</script>

<template>
  <div class="dd app-ui desk" :style="{ '--u': `calc(100cqw / ${width ?? 1440})` }">
    <aside class="side">
      <div class="eyebrow home-brand"><PixelMark class="home-logo" :boot="false" :glow="false" />wherdr · herdr 0.9.1</div>
      <div class="home-title-row">
        <h3 class="home-title">Agents</h3>
        <div class="home-actions">
          <span class="icon-btn"><UIcon name="i-lucide-search" /></span>
          <span class="icon-btn"><UIcon name="i-lucide-settings-2" /></span>
          <span class="icon-btn"><UIcon name="i-lucide-panel-left-close" /></span>
        </div>
      </div>
      <div class="session-row"><span><UIcon name="i-lucide-layers" />devbox</span><b>default<UIcon name="i-lucide-chevron-right" /></b></div>
      <DemoCounts :agents="agents" />
      <div class="card-list">
        <DemoAgentCard v-for="a in agents" :key="a.name" :agent="a" :selected="a.name === active" />
      </div>
    </aside>

    <section class="main">
      <template v-for="a in agents.filter(x => x.name === active)" :key="a.name">
        <header class="agent-top">
          <div class="agent-head">
            <div class="agent-title">{{ a.name }}</div>
            <div class="agent-meta">
              <DemoPill :state="a.state" :kind="KIND_LABEL[a.agent].toLowerCase()" />
              <span v-if="subtitle" class="agent-subtitle">{{ subtitle }}</span>
              <span class="where">{{ where }}</span>
            </div>
          </div>
          <div class="agent-actions">
            <div class="hw-tabs"><span class="hw-tab" :class="{ on: !terminal }">Conversation</span><span class="hw-tab" :class="{ on: terminal }">Terminal</span></div>
            <span class="icon-btn"><UIcon name="i-lucide-plus" /></span>
            <span class="icon-btn"><UIcon name="i-lucide-search" /></span>
            <span class="icon-btn"><UIcon name="i-lucide-ellipsis" /></span>
          </div>
        </header>
      </template>
      <div class="content">
        <div class="col">
          <div class="read"><slot /></div>
          <div class="read bottom"><slot name="bottom" /></div>
        </div>
        <aside v-if="$slots.aside" class="panel"><slot name="aside" /></aside>
      </div>
    </section>
  </div>
</template>

<style scoped>
.dd { position: absolute; inset: 0; display: flex; }
.side {
  flex: none; width: calc(var(--u) * 340); padding: calc(var(--u) * 20) calc(var(--u) * 12);
  display: flex; flex-direction: column; gap: calc(var(--u) * 10);
  border-right: 1px solid var(--line); background: var(--bg); overflow: hidden;
}
.side .home-title { font-size: calc(var(--u) * 34); }
.side .stats { margin: calc(var(--u) * 4) 0 calc(var(--u) * 14); }
.main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.content { flex: 1; min-height: 0; display: flex; }
/* Reading column (--read 760 px), framed by thin lines, grid in the margins. */
.col {
  flex: 1; min-width: 0; display: flex; flex-direction: column;
  background-image: linear-gradient(90deg, transparent calc(50% - var(--u) * 380), var(--line) calc(50% - var(--u) * 380), var(--line) calc(50% - var(--u) * 380 + 1px), transparent calc(50% - var(--u) * 380 + 1px), transparent calc(50% + var(--u) * 380 - 1px), var(--line) calc(50% + var(--u) * 380 - 1px), var(--line) calc(50% + var(--u) * 380), transparent calc(50% + var(--u) * 380));
}
.read { width: 100%; max-width: calc(var(--u) * 760); margin: 0 auto; }
.read:first-child { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; justify-content: flex-end; padding: calc(var(--u) * 18) calc(var(--u) * 16) calc(var(--u) * 8); }
.bottom :deep(.composer) { padding-bottom: calc(var(--u) * 18); }
.panel { flex: none; width: calc(var(--u) * 400); border-left: 1px solid var(--line); background: var(--bg); overflow: hidden; }
</style>
