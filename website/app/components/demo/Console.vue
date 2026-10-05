<script setup lang="ts">
// The agent's console as wherdr draws it while the agent works: tool calls
// (`❯ tool arg`) grouped under the gliding ring, with a pulse while running.
defineProps<{ actions: readonly { tool: string, arg: string }[], running: boolean, agent?: string, icon?: string }>()
</script>

<template>
  <div class="console fx-ring">
    <div class="head">
      <UIcon :name="icon ?? 'i-herdr-omp'" class="logo" />
      <span>{{ agent ?? 'omp' }}</span>
      <span class="demo-dim">· {{ actions.length }} action{{ actions.length === 1 ? '' : 's' }}</span>
      <span v-if="running" class="spin demo-pulse">●</span>
    </div>
    <div v-for="a in actions" :key="a.tool + a.arg" class="act demo-rise">
      <span class="caret">❯</span> <b>{{ a.tool }}</b> <span class="arg">{{ a.arg }}</span>
    </div>
  </div>
</template>

<style scoped>
.console {
  --fx-fill: var(--bg-2); --fx-speed: 6s;
  padding: calc(var(--u) * 10) calc(var(--u) * 12);
  font: calc(var(--u) * 13) / 1.55 var(--mono);
}
.head { display: flex; align-items: center; gap: calc(var(--u) * 6); margin-bottom: calc(var(--u) * 4); font-size: calc(var(--u) * 11); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.logo { width: calc(var(--u) * 15); height: calc(var(--u) * 15); }
.spin { margin-left: auto; color: var(--accent); }
.act { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--muted); }
.act b { color: var(--text); font-weight: 600; }
.caret { color: var(--omp); }
.arg { color: var(--dim); }
</style>
