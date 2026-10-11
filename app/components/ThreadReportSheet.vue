<script setup lang="ts">
// Report of a thread (useThreadReport.ts), mounted once in app.vue.
import { projectOf } from '#shared/projects'

const report = threadReport
const open = threadReportOpen
// The thread's live agent, while the sheet is open.
const pane = computed(() => {
  const r = report.value
  const coordinator = r && herdrState.value.panes.find(p => p.id === r.coordinator)
  const slug = coordinator && projectOf(coordinator)
  return coordinator && slug ? threadLivePane(coordinator, slug, r.thread) : undefined
})

function openAgent() {
  if (!pane.value) return
  open.value = false
  navigateTo(panePath(pane.value.id))
}
</script>

<template>
  <AppSheet v-model:open="open" :title="report ? `${report.thread.id.toUpperCase()} · ${report.thread.title}` : ''" wide tall screen>
    <div v-if="report" class="pp-report">
      <div class="pp-report-actions">
        <UButton v-if="pane" icon="i-lucide-message-square" color="neutral" variant="outline" size="sm" @click="openAgent">{{ t('Open agent') }}</UButton>
        <UButton v-if="report.thread.pr" icon="i-lucide-git-pull-request" color="neutral" variant="outline" size="sm" :to="report.thread.pr" target="_blank" rel="noopener">{{ t('Pull request') }}</UButton>
      </div>
      <div class="md"><ChatMarkdown :html="report.html" :typing="null" /></div>
      <p v-if="report.truncated" class="pp-notice">{{ t('Report truncated (too long).') }}</p>
    </div>
  </AppSheet>
</template>
