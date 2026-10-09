<script setup lang="ts">
// Long typed message: folded after ~12 lines (CSS .msg-fold.folded), with a
// fade and a Show more / Show less button. Measured on its content, so a
// width change (rotation, resized list) folds or unfolds it again.
const box = ref<HTMLElement | null>(null)
const long = ref(false)
const expanded = ref(false)
let ro: ResizeObserver | null = null
function measure() {
  const el = box.value
  if (!el) return
  // Height of 12 lines plus a little slack: no button for 12½ lines.
  const limit = (Number.parseFloat(getComputedStyle(el).lineHeight) || 22.5) * 12.5
  long.value = el.scrollHeight > limit
}
onMounted(() => {
  measure()
  ro = new ResizeObserver(measure)
  if (box.value) ro.observe(box.value)
})
onUpdated(measure)
onBeforeUnmount(() => ro?.disconnect())
</script>

<template>
  <span ref="box" class="msg-fold" :class="{ folded: long && !expanded }" style="display: block"><slot /></span>
  <button v-if="long" type="button" class="msg-fold-btn" :aria-expanded="expanded" @click="expanded = !expanded">
    {{ expanded ? tl('Show less', 'Afficher moins') : tl('Show more', 'Afficher plus') }}
  </button>
</template>
