<script setup lang="ts">
// A place an agent opened with `ui open` (shared/uiOpen.ts), as a card above
// the message field: who opened it and where; a tap opens it, × dismisses it.
import { appRoute, linkedTask } from '#shared/appLinks'
import { uiPlaceLabel, type UiOpenEvent } from '#shared/uiOpen'

const props = defineProps<{ event: UiOpenEvent }>()
const emit = defineEmits<{ close: [] }>()
const router = useRouter()
const label = computed(() => uiPlaceLabel(props.event.link))
function open() {
  const task = linkedTask(props.event.link)
  if (task) openTaskSheet(task)
  else router.push(appRoute(props.event.link))
  emit('close')
}
</script>

<template>
  <div class="ui-open-row">
    <div class="ui-open-card" role="status">
      <button type="button" class="ui-open-main" @click="open">
        <span class="ui-open-by">{{ tl(`Opened by ${event.by}`) }}</span>
        <span class="ui-open-place"><UIcon name="i-lucide-panel-right-open" />{{ label }}</span>
      </button>
      <button type="button" class="ui-open-x" :aria-label="t('Close')" :title="t('Close')" @click="emit('close')">
        <UIcon name="i-lucide-x" />
      </button>
    </div>
  </div>
</template>
