<script setup lang="ts">
// Needs you now: one card on Home, right above Tasks to review, listing the
// tasks whose worker cannot go on without a person (a login, a passkey, 2FA, a
// payment, an approval: ToHandle.needsHuman, shared/pm/needsHuman.ts) on the
// projects the home tab shows (useMachineBar.projectOnBar). Each row: its id
// badge in the project's color, its title, what is needed and where (the url
// as a plain, ellipsized hint). A tap opens the task's sheet. Hidden when
// nothing needs the user. Reads like ReviewCard (same poll); ReviewCard owns
// the home load mark.
import type { ToHandle } from '#shared/pm/board'

const all = ref<ToHandle[]>([])
const tasks = computed(() => all.value.filter(x => x.needsHuman && projectOnBar(x.project)))
const load = () => api<ToHandle[]>('/api/pm/handle').then((v) => { all.value = Array.isArray(v) ? v : [] }, () => {})
let timer: ReturnType<typeof setInterval> | undefined
// Read while the card is on screen: a hidden page waits for the next tick it is shown.
onMounted(() => { load(); timer = setInterval(() => { if (!document.hidden) load() }, 15_000) })
onBeforeUnmount(() => clearInterval(timer))
watch(taskSheetTick, load) // an action in a task's sheet or the review sheet
</script>

<template>
  <section v-if="tasks.length" class="agent-group blocked needs-group" data-testid="needs-you">
    <h2 class="group-title"><span>{{ tl('Needs you now') }}</span></h2>
    <button v-for="x in tasks" :key="x.id" type="button" class="review-card needs-card press-row" :data-task="x.id" data-testid="needs-you-row" @click="openTaskSheet(x.id)">
      <ProjectBadge :text="x.shown" :color="x.color" />
      <span class="needs-text">
        <b>{{ x.title }}</b>
        <small class="needs-kind"><span data-testid="needs-you-kind">{{ x.needsHuman!.kind }}</span><template v-if="x.needsHuman!.url"><span aria-hidden="true">&nbsp;·&nbsp;</span><span class="needs-url" data-testid="needs-you-url">{{ x.needsHuman!.url }}</span></template></small>
      </span>
      <UIcon name="i-lucide-chevron-right" class="needs-go" />
    </button>
  </section>
</template>

<style scoped>
.needs-group { display: grid; gap: 0; }
.needs-card + .needs-card { border-top: 0; }
.needs-text { flex: 1; min-width: 0; display: grid; gap: 2px; }
.needs-text b { overflow: hidden; font: 600 14px/1.3 var(--display); text-overflow: ellipsis; white-space: nowrap; }
.needs-text small { display: flex; min-width: 0; color: var(--muted); font: 12px/1.4 var(--mono); white-space: nowrap; }
.needs-url { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.needs-go { flex: none; color: var(--muted); }
</style>
