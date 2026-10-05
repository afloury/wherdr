<script setup lang="ts">
// "Works with": the agents wherdr knows, with the app's icons
// (app/utils/agentIcons.ts: brand logos for Claude Code, Codex and omp, lucide
// for Gemini, OpenCode and Kimi), then the other agents Herdr recognizes.
// Slides slowly in a loop, pauses on hover; still with prefers-reduced-motion.
const AGENTS: { name: string, icon?: string, color?: string, full?: boolean }[] = [
  { name: 'Claude Code', icon: 'i-herdr-claude-code', color: 'var(--claude)', full: true },
  { name: 'Codex', icon: 'i-herdr-codex', color: 'var(--codex)', full: true },
  { name: 'omp', icon: 'i-herdr-omp', full: true },
  { name: 'Gemini CLI', icon: 'i-lucide-sparkles' },
  { name: 'OpenCode', icon: 'i-lucide-code-xml' },
  { name: 'Kimi', icon: 'i-lucide-moon-star' },
  { name: 'Pi' }, { name: 'Cursor' }, { name: 'Copilot' }, { name: 'Cline' }, { name: 'Kilo' },
  { name: 'Droid' }, { name: 'Amp' }, { name: 'Devin' }, { name: 'Kiro' }, { name: 'Qwen' },
  { name: 'Grok' }, { name: 'Qoder' }, { name: 'Letta' }, { name: 'Hermes' },
]
</script>

<template>
  <div class="am">
    <span class="label lead-label">Works with</span>
    <div class="track-wrap">
      <!-- Two identical copies: the track slides by one copy, seamlessly. -->
      <div class="track">
        <ul v-for="copy in 2" :key="copy" class="row" :aria-hidden="copy === 2 ? 'true' : undefined" :aria-label="copy === 1 ? 'Agents that work with wherdr' : undefined">
          <li v-for="a in AGENTS" :key="a.name" :class="{ full: a.full }" :title="a.full ? `${a.name}: full conversation view` : `${a.name}: list and terminal`">
            <UIcon v-if="a.icon" :name="a.icon" class="ico" :style="a.color ? { color: a.color } : undefined" />
            <span v-else class="sq" aria-hidden="true" />
            {{ a.name }}
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.am { display: flex; align-items: center; gap: 24px; padding-top: 20px; border-top: 1px solid var(--line); min-width: 0; }
.lead-label { flex: none; }
.track-wrap {
  flex: 1; min-width: 0; overflow: hidden;
  -webkit-mask: linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent);
  mask: linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent);
}
@keyframes slide { to { transform: translateX(-50%); } }
.track { display: flex; width: max-content; animation: slide 60s linear infinite; }
.track-wrap:hover .track { animation-play-state: paused; }
.row { display: flex; align-items: center; gap: 36px; margin: 0; padding: 0 36px 0 0; list-style: none; }
.row li { display: flex; align-items: center; gap: 10px; white-space: nowrap; font: 13px/1 var(--mono); color: var(--muted); }
.row li.full { color: var(--text); }
.ico { width: 18px; height: 18px; flex: none; color: var(--text); }
.sq { width: 7px; height: 7px; flex: none; border: 1px solid var(--line-strong); }
@media (max-width: 760px) {
  .am { flex-direction: column; align-items: flex-start; gap: 14px; }
  .track-wrap { width: 100%; }
}
@media (prefers-reduced-motion: reduce) {
  .track { animation: none; width: auto; }
  .row { flex-wrap: wrap; gap: 14px 28px; }
  .row[aria-hidden="true"] { display: none; }
}
</style>
