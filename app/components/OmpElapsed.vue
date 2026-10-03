<script setup lang="ts">
// Time since `since`, written like omp ("47s", "2m 5s"), once a second.
import { ompElapsed } from '~/utils/ompSpinner'

const props = defineProps<{ since: number }>()
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { timer = setInterval(() => { now.value = Date.now() }, 1000) })
onBeforeUnmount(() => { if (timer) clearInterval(timer) })
</script>

<template>
  <span class="omp-elapsed-time">{{ ompElapsed(props.since, now) }}</span>
</template>
