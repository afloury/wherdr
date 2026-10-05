<script setup lang="ts">
// "Your turn": the agent's question with numbered answers, as wherdr shows
// it under the conversation (`edge`: full width, phone) or in a box.
defineProps<{ question: string, options: readonly { n: number, title: string, sub: string }[], picked?: number, edge?: boolean }>()
</script>

<template>
  <div class="turn" :class="{ edge }">
    <div class="tlabel"><i class="demo-sq" /> Your turn</div>
    <div class="q">{{ question }}</div>
    <div class="opts">
      <div v-for="o in options" :key="o.n" class="opt" :class="{ picked: picked === o.n }">
        <span class="num">{{ o.n }}</span>
        <span><span class="ot">{{ o.title }}</span><span class="os">{{ o.sub }}</span></span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.turn {
  padding: calc(var(--u) * 12) calc(var(--u) * 16);
  border: 1px solid color-mix(in srgb, var(--rose) 45%, var(--line));
  background: linear-gradient(color-mix(in srgb, var(--rose) 7%, var(--bg)), var(--bg));
}
.turn.edge { margin: 0 calc(var(--u) * -16); padding-bottom: 0; border-width: 1px 0 0; }
.tlabel { display: flex; align-items: center; font: 600 calc(var(--u) * 12) / 1 var(--mono); letter-spacing: .14em; text-transform: uppercase; color: var(--rose); }
.q { margin: calc(var(--u) * 8) 0 calc(var(--u) * 10); font-weight: 700; color: #fff; }
.opts { border: 1px solid var(--line); }
.opt { display: flex; gap: calc(var(--u) * 16); padding: calc(var(--u) * 9) calc(var(--u) * 14); border-bottom: 1px solid var(--line); background: var(--bg-2); transition: background .25s, box-shadow .25s; }
.opt:last-child { border-bottom: 0; }
.num { font: 600 calc(var(--u) * 13) / 1.6 var(--mono); color: var(--rose); }
.ot { display: block; color: var(--text); }
.os { display: block; font-size: calc(var(--u) * 13); color: var(--muted); }
.turn:not(.edge) .ot, .turn:not(.edge) .os { display: inline; margin-right: calc(var(--u) * 12); }
.opt.picked { background: color-mix(in srgb, var(--accent) 14%, var(--bg-2)); box-shadow: inset 0 0 0 1px var(--accent); }
.opt.picked .num { color: var(--accent); }
</style>
