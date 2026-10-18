<script setup lang="ts">
// Text of a task, inline: URLs and Markdown links are plain links; inline
// code (`npm test`) looks as in a conversation (tinted by what it holds,
// utils/codeKind.ts). A tap on the code opens its menu: Copy, and Run… when
// it reads as a command and the coordinator (`paneId`) can run it in its
// shell mode, after a confirmation (composables/useCodeRun.ts, as in the
// conversation). Dropdown at the code on a computer, sheet on the phone.
import type { QueuedMessage } from '#shared/types'
import { textParts } from '#shared/projectBoard'

const props = defineProps<{ text: string, paneId?: string }>()
const emit = defineEmits<{ sent: [queued: QueuedMessage | null] }>()
const parts = computed(() => textParts(props.text))
const kindOf = (code: string) => codeKind(code) ?? undefined

const menu = reactive({ open: false, x: 0, y: 0, w: 0, h: 0 })
const dropdown = ref<ReturnType<typeof toDropdown>>([])
const fileName = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p

function items(code: string): { title: string, items: MenuItem[] } {
  const cmd = inlineCommand(code)
  const pane = props.paneId ? herdrState.value.panes.find(p => p.id === props.paneId) : undefined
  const list: MenuItem[] = []
  if (cmd !== null && canRunIn(pane)) {
    list.push({ label: tl('Run…', 'Lancer…'), icon: 'i-lucide-play', run: () => run(pane.id, cmd) })
  }
  // A command is copied without the prompt written in front of it ("! ", "$ ").
  const copied = cmd ?? code
  const isPath = cmd === null && kindOf(code) === 'path'
  list.push({ label: cmd !== null ? t('Copy command') : isPath ? t('Copy path') : t('Copy'), icon: 'i-lucide-copy', desc: copied, mono: true, run: () => copyCode(copied) })
  return { title: cmd !== null ? tl('Command', 'Commande') : isPath ? fileName(code) : 'Code', items: list }
}
async function run(paneId: string, cmd: string) {
  // The pane as it is now: it may have changed while the menu was open.
  const pane = herdrState.value.panes.find(p => p.id === paneId)
  if (!pane) return
  const queued = await runInAgent(pane, cmd)
  if (queued !== false) emit('sent', queued)
}
function open(e: Event, code: string) {
  const { title, items: list } = items(code)
  if (sheetMenus.value) {
    haptic()
    openMenu(list, title)
    return
  }
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  Object.assign(menu, { x: r.left, y: r.top, w: r.width, h: r.height })
  dropdown.value = toDropdown(list)
  menu.open = true
}
</script>

<template>
  <template v-for="(x, i) in parts" :key="i"><code
    v-if="x.code" class="pp-code" :data-k="kindOf(x.text)" role="button" tabindex="0" :aria-haspopup="'menu'"
    @click.stop.prevent="open($event, x.text)" @keydown.enter.space.stop.prevent="open($event, x.text)"
  >{{ x.text }}</code><a v-else-if="x.href" class="pp-tlink" :href="x.href" target="_blank" rel="noopener noreferrer" @click.stop>{{ x.text }}</a><template v-else>{{ x.text }}</template></template>
  <Teleport v-if="dropdown.length" to="body">
    <UDropdownMenu v-if="!sheetMenus" v-model:open="menu.open" :items="dropdown" :content="{ align: 'start', side: 'bottom', sideOffset: 4 }" :ui="{ content: 'hw-dropdown' }">
      <span class="path-anchor" :style="{ left: `${menu.x}px`, top: `${menu.y}px`, width: `${menu.w}px`, height: `${menu.h}px` }" aria-hidden="true" />
    </UDropdownMenu>
  </Teleport>
</template>
