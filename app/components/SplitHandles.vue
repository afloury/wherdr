<script setup lang="ts">
// Handles of wherdr's split tree (computer only): one USplitter per split, nested
// like the tree, laid over the tab's cells. Its panels are empty and let the pointer
// through, so the cells (live terminals) are never moved or remounted: they follow
// `preview` while a handle is dragged, and the tree is written once on release
// (`resize`). Arrows: 5 % steps; double-click: back to 50/50. Each side keeps 15 %.
import type { SplitNode } from '#shared/splitTree'

const props = withDefaults(defineProps<{ node: SplitNode, path?: string }>(), { path: '' })
const emit = defineEmits<{ preview: [path: string, ratio: number | null], resize: [path: string, ratio: number] }>()

const splitter = useTemplateRef<{ $el: HTMLElement, panelsRef: { resize: (size: number) => void }[] }>('splitter')
// A side already under 15 % (a tall stack of terminals) is not grown on its own.
const items = computed(() => [props.node.ratio * 100, (1 - props.node.ratio) * 100].map(size => ({ defaultSize: size, minSize: Math.min(15, size) })))
const ui = computed(() => ({ root: 'split-handles', panel: 'split-handles-panel', handle: `split-handle ${props.node.dir} ${props.node.dir === 'right' ? 'w-0' : 'h-0'} focus-visible:outline-none` }))

let dragging = false
let shown = props.node.ratio
function onLayout(sizes: number[]) {
  // USplitter keeps the bounds (minSize); not clamped again, to leave a stack's small side be.
  const ratio = Math.round((sizes[0] ?? 50) * 10) / 1000
  shown = ratio
  if (dragging) emit('preview', props.path, ratio)
  // Keyboard, double-click: written at once; a layout matching the tree writes nothing.
  else if (Math.abs(ratio - props.node.ratio) >= 0.005) emit('resize', props.path, ratio)
}
function onDragging(_: number, on: boolean) {
  dragging = on
  if (on) return emit('preview', props.path, shown)
  emit('preview', props.path, null)
  if (Math.abs(shown - props.node.ratio) >= 0.005) emit('resize', props.path, shown)
}
const setRatio = (ratio: number) => splitter.value?.panelsRef[0]?.resize(ratio * 100)
// The tree changed elsewhere (another device, a split): the handle follows.
watch(() => props.node.ratio, (r) => { if (!dragging && Math.abs(r - shown) >= 0.005) setRatio(r) })

function onDblclick(e: MouseEvent) {
  const handle = (e.target as Element).closest('[data-slot="handle"]')
  if (handle?.parentElement === e.currentTarget && props.node.ratio !== 0.5) setRatio(0.5)
}
// Reka gives the handle its role and values; the line's orientation and name are ours.
function label() {
  for (const h of splitter.value?.$el.querySelectorAll(':scope > [data-slot="handle"]') ?? []) {
    h.setAttribute('aria-orientation', props.node.dir === 'right' ? 'vertical' : 'horizontal')
    h.setAttribute('aria-label', t('Resize'))
    h.setAttribute('title', t('Drag to resize, double-click for 50/50'))
  }
}
onMounted(label)
watch(() => props.node.dir, () => nextTick(label))
</script>

<template>
  <USplitter
    :key="node.dir" ref="splitter" :orientation="node.dir === 'right' ? 'horizontal' : 'vertical'" :items="items"
    :keyboard-resize-by="5" :hit-area-margins="{ coarse: 8, fine: 5 }" :ui="ui"
    @layout="onLayout" @dragging="onDragging" @dblclick="onDblclick"
  >
    <template #panel-0>
      <SplitHandles v-if="typeof node.a !== 'string'" :node="node.a" :path="`${path}0`" @preview="(p, r) => emit('preview', p, r)" @resize="(p, r) => emit('resize', p, r)" />
    </template>
    <template #panel-1>
      <SplitHandles v-if="typeof node.b !== 'string'" :node="node.b" :path="`${path}1`" @preview="(p, r) => emit('preview', p, r)" @resize="(p, r) => emit('resize', p, r)" />
    </template>
  </USplitter>
</template>
