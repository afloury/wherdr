<script setup lang="ts">
// wherdr's message field: text (or placeholder), + button, model and effort
// pickers, send button. `desktop` adds the keyboard hints and the gliding
// ring with its halo; `menu` opens the effort picker's list.
defineProps<{
  text?: string
  placeholder: string
  model: string
  effort: string
  desktop?: boolean
  menu?: readonly string[]
}>()
</script>

<template>
  <div class="composer" :class="desktop ? 'desk fx-ring halo' : 'phone'">
    <div class="field">
      <span v-if="text">{{ text }}<i class="caret-bar" /></span>
      <span v-else class="ph">{{ placeholder }}</span>
    </div>
    <div class="row">
      <span class="plus"><UIcon name="i-lucide-plus" class="demo-mi" /></span>
      <span class="pick">{{ model }} <UIcon name="i-lucide-chevron-down" class="demo-mi" /></span>
      <span class="pick effort" :class="{ open: menu }">
        {{ effort }} <UIcon name="i-lucide-chevron-down" class="demo-mi" />
        <span v-if="menu" class="menu demo-rise">
          <span v-for="m in menu" :key="m" class="item" :class="{ on: m === effort }">{{ m }}<UIcon v-if="m === effort" name="i-lucide-check" class="demo-mi" /></span>
        </span>
      </span>
      <span v-if="desktop" class="keys">↵ send · ⇧↵ new line</span>
      <span class="send" :class="{ on: text }"><UIcon name="i-lucide-arrow-up" class="demo-mi" /></span>
    </div>
  </div>
</template>

<style scoped>
.composer { flex: none; }
.field { min-height: calc(var(--u) * 50); padding: calc(var(--u) * 12) calc(var(--u) * 14) calc(var(--u) * 6); font-size: calc(var(--u) * 15); line-height: 1.35; }
.ph { color: var(--dim); }
.caret-bar { display: inline-block; width: 1px; height: 1.1em; margin-left: 1px; vertical-align: -.2em; background: var(--accent); }
.row { display: flex; align-items: center; gap: calc(var(--u) * 12); padding: calc(var(--u) * 6) calc(var(--u) * 8) calc(var(--u) * 8); font: 600 calc(var(--u) * 13) / 1 var(--mono); color: var(--muted); }
.plus { display: grid; place-items: center; width: calc(var(--u) * 32); height: calc(var(--u) * 32); border: 1px solid var(--line-strong); color: var(--text); }
.pick { position: relative; display: inline-flex; align-items: center; gap: calc(var(--u) * 4); padding: calc(var(--u) * 6); transition: background .2s, color .2s; }
.pick.open { background: var(--surface-2); color: var(--text); }
.menu { position: absolute; left: 0; bottom: calc(100% + var(--u) * 6); z-index: 2; display: flex; flex-direction: column; min-width: calc(var(--u) * 150); border: 1px solid var(--line-strong); background: var(--surface); box-shadow: 0 calc(var(--u) * 12) calc(var(--u) * 30) rgba(0, 0, 0, .5); }
.item { display: flex; align-items: center; justify-content: space-between; padding: calc(var(--u) * 9) calc(var(--u) * 12); color: var(--muted); font-weight: 500; }
.item.on { background: color-mix(in srgb, var(--accent) 14%, var(--surface)); color: var(--text); }
.keys { margin-left: auto; font-weight: 400; font-size: calc(var(--u) * 12); color: var(--dim); }
.send { display: grid; place-items: center; margin-left: auto; width: calc(var(--u) * 32); height: calc(var(--u) * 32); background: var(--surface-2); color: var(--dim); transition: background .2s, color .2s; }
.keys + .send { margin-left: 0; }
.send.on { background: var(--accent); color: var(--on-accent); }

/* Phone: boxed field, no ring. */
.phone .field { border: 1px solid var(--line-strong); border-bottom: 0; background: var(--bg-2); }
.phone .row { border: 1px solid var(--line-strong); border-top: 0; background: var(--bg-2); }
/* Computer: the ring of the app's field. */
.desk { --fx-fill: var(--bg-2); --fx-glow: calc(var(--u) * 10); }
.desk .field { min-height: calc(var(--u) * 46); font-size: calc(var(--u) * 16); }
</style>
