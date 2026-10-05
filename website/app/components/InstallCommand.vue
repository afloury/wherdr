<script setup lang="ts">
// The one-line install command, copied in one click.
const props = withDefaults(defineProps<{ command?: string, halo?: boolean }>(), {
  command: 'curl -fsSL https://wherdr.dev/install | sh',
  halo: true,
})
const copied = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined

async function copy() {
  try {
    await navigator.clipboard.writeText(props.command)
  } catch {
    // Old browsers / insecure context: select the text instead.
    const sel = window.getSelection()
    const el = document.getElementById('install-cmd-text')
    if (sel && el) { const r = document.createRange(); r.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(r) }
    return
  }
  copied.value = true
  clearTimeout(timer)
  timer = setTimeout(() => { copied.value = false }, 1800)
}
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <div class="cmd fx-ring" :class="{ halo }">
    <span class="prompt" aria-hidden="true">$</span>
    <code id="install-cmd-text" class="text">{{ command }}</code>
    <button type="button" class="copy" :aria-label="copied ? 'Copied' : 'Copy the install command'" @click="copy">
      <UIcon :name="copied ? 'i-lucide-check' : 'i-lucide-copy'" class="size-4" />
      <span class="txt">{{ copied ? 'Copied' : 'Copy' }}</span>
    </button>
    <span class="sr-only" aria-live="polite">{{ copied ? 'Command copied to the clipboard' : '' }}</span>
  </div>
</template>

<style scoped>
.cmd {
  display: flex; align-items: stretch; gap: 0;
  font-family: var(--mono); font-size: 14px;
  max-width: 100%;
}
@media (max-width: 420px) {
  .cmd { font-size: 12.5px; }
  .cmd .text { white-space: normal; overflow-wrap: anywhere; }
}
.prompt { display: grid; place-items: center; padding: 0 4px 0 18px; color: var(--green); font-weight: 600; user-select: none; }
.text {
  flex: 1; min-width: 0; padding: 15px 14px 15px 8px;
  color: var(--text); white-space: nowrap; overflow-x: auto; scrollbar-width: none;
}
.text::-webkit-scrollbar { display: none; }
.copy {
  display: inline-flex; align-items: center; gap: 8px; flex: none;
  padding: 0 18px; border: 0; border-left: 1px solid var(--line);
  background: transparent; color: var(--muted); cursor: pointer;
  font: 600 12px/1 var(--mono); letter-spacing: .1em; text-transform: uppercase;
  transition: color .15s, background .15s;
}
.copy:hover { color: var(--text); background: var(--surface); }
@media (max-width: 520px) {
  .cmd { font-size: 13px; }
  .copy .txt { display: none; }
  .copy { padding: 0 14px; }
}
</style>
