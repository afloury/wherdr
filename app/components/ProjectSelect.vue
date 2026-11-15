<script setup lang="ts">
// A USelect that lists projects: each project option shows its key badge in
// its color, then its name, in the list and in the closed picker. Other
// options (Follow…, All, a group) keep the plain look. An option's count (what
// waits under it) shows right-aligned and muted, none at 0. Attributes go to USelect.
// The menu stays inside the screen: a long name ends with an ellipsis.
import type { ProjectOption } from '~/utils/projectOption'

defineOptions({ inheritAttrs: false })
const props = defineProps<{ items: ProjectOption[] }>()
const model = defineModel<string>()
const picked = computed(() => props.items.find(i => i.value === model.value))
</script>

<template>
  <USelect v-model="model" :items="items" :ui="{ content: 'w-max min-w-(--reka-select-trigger-width) max-w-[calc(100vw-2rem)]', value: 'flex-1 min-w-0', itemTrailing: 'self-center' }" v-bind="$attrs">
    <template v-if="picked?.badge || picked?.count" #default>
      <span class="project-select-value"><ProjectBadge v-if="picked.badge" :text="picked.badge.text" :color="picked.badge.color" /><span class="truncate">{{ picked.label }}</span><span v-if="picked.count" class="project-select-count" data-testid="option-count">{{ picked.count }}</span></span>
    </template>
    <template #item-leading="{ item }">
      <ProjectBadge v-if="item.badge" :text="item.badge.text" :color="item.badge.color" />
    </template>
    <template #item-trailing="{ item }">
      <span v-if="item.count" class="project-select-count" data-testid="option-count">{{ item.count }}</span>
    </template>
  </USelect>
</template>

<style scoped>
.project-select-value { display: flex; flex: 1; align-items: center; gap: 6px; min-width: 0; }
.project-select-count { margin-left: auto; padding-left: 12px; color: var(--muted); font-family: var(--mono); font-size: 12px; font-variant-numeric: tabular-nums; }
</style>
