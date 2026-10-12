<script setup lang="ts">
// [b:color(text)](target) badges of a task: palette (follows the theme) or
// validated hex; target URL (new tab) or thread (opens it if it exists).
import type { Pane } from '#shared/types'
import type { ProjectBoard, TaskBadge } from '#shared/projectBoard'
import { threadPanesOf } from '#shared/globalBoard'

const props = defineProps<{ badges: TaskBadge[], coordinator: Pane, board: ProjectBoard | null }>()

const BADGE_MAX = 24
const short = (b: TaskBadge) => (b.text.length > BADGE_MAX ? `${b.text.slice(0, BADGE_MAX - 1)}…` : b.text)
const colorClass = (b: TaskBadge) => [b.color?.startsWith('#') ? 'hex' : b.color ? `c-${b.color}` : '', { link: Boolean(b.href || b.thread) }]
const colorStyle = (b: TaskBadge) => (b.color?.startsWith('#') ? { '--bc': b.color } : undefined)
const threadOf = (id: string) => props.board?.open.find(x => x.id === id) || props.board?.resolved.find(x => x.id === id)

function title(b: TaskBadge) {
  if (b.href) return b.href
  if (b.thread) {
    const th = threadOf(b.thread)
    if (!th || !props.board) return tl(`${b.thread}: unknown thread`, `${b.thread} : thread inconnu`)
    const open = threadPanesOf(th, props.board.slug, herdrState.value.panes, props.coordinator.machine || '').length > 0
    return `${b.thread} · ${th.title} · ${threadLabel(th)}${open ? '' : tl(' · no open tab', ' · pas d’onglet ouvert')}`
  }
  return b.text.length > BADGE_MAX ? b.text : undefined
}

function openBadgeThread(b: TaskBadge) {
  const th = threadOf(b.thread!)
  if (th && props.board) openThread(props.coordinator, props.board.slug, th)
  else toast(title(b)!, true)
}
</script>

<template>
  <template v-for="(b, j) in badges" :key="`b${j}`">
    <a v-if="b.href" class="pp-badge" :class="colorClass(b)" :style="colorStyle(b)" :title="title(b)" :href="b.href" target="_blank" rel="noopener noreferrer" @click="haptic()">{{ short(b) }}<i class="pp-badge-go" aria-hidden="true">↗</i></a>
    <button v-else-if="b.thread" type="button" class="pp-badge" :class="colorClass(b)" :style="colorStyle(b)" :title="title(b)" @click="openBadgeThread(b)">{{ short(b) }}<i class="pp-badge-go" aria-hidden="true">↗</i></button>
    <span v-else class="pp-badge" :class="colorClass(b)" :style="colorStyle(b)" :title="title(b)">{{ short(b) }}</span>
  </template>
</template>
