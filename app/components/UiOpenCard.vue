<script setup lang="ts">
// A place an agent opened with `ui open` (shared/uiOpen.ts), as a card above
// the message field: who opened it and where; a tap opens it, × dismisses it.
// kept: the same card in the agent's reply (ChatMarkdown.vue), with no ×.
import { appRoute, linkedTask } from '#shared/appLinks'
import { uiPlaceLabel, type UiOpenEvent } from '#shared/uiOpen'

const props = defineProps<{ event: UiOpenEvent, kept?: boolean }>()
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
  <div :class="{ 'ui-open-row': !kept }">
    <div class="ui-open-card" role="status">
      <button type="button" class="ui-open-main" @click="open">
        <span class="ui-open-by">{{ event.by ? tl(`Opened by ${event.by}`) : t('Place in wherdr') }}</span>
        <span class="ui-open-place"><UIcon name="i-lucide-panel-right-open" />{{ label }}</span>
      </button>
      <button v-if="!kept" type="button" class="ui-open-x" :aria-label="t('Close')" :title="t('Close')" @click="emit('close')">
        <UIcon name="i-lucide-x" />
      </button>
    </div>
  </div>
</template>
