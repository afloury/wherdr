<script setup lang="ts">
import type { TaskRow } from '#shared/projectsTasks'

const props = defineProps<{ machine: string, repo: string, machineLabel: string, tasks: TaskRow[], disabled?: boolean }>()
const emit = defineEmits<{ refresh: [] }>()
const busy = ref(false)
const done = computed(() => props.tasks.filter(t => t.repo === props.repo && t.group === 'done' && !t.archived).length)
const unavailable = computed(() => props.disabled || offlineView.value || busy.value || !done.value)
const label = () => tl('Archive completed tasks', 'Archiver les tâches terminées')
async function archive() {
  if (unavailable.value) return
  busy.value = true
  try {
    const ok = await askConfirm(tl(
      `Archive completed tasks in ${props.repo} on ${props.machineLabel}? Completed tasks currently known: ${done.value}. Pinned tasks are kept, as are working and to-do tasks.`,
      `Archiver les tâches terminées de ${props.repo} sur ${props.machineLabel} ? Tâches terminées actuellement connues : ${done.value}. Les tâches épinglées, en cours et à faire sont conservées.`), label())
    if (!ok || props.disabled || offlineView.value || !done.value) return
    try {
      const r = await api<{ code: number, stdout: string, stderr: string }>('/api/tasks/archive-done', { machine: props.machine, repo: props.repo })
      Object.assign(commandResult, { open: true, pane: null, cmd: label(), text: [r.stdout, r.stderr, r.code ? tl(`Exit code: ${r.code}`, `Code de sortie : ${r.code}`) : ''].filter(Boolean).join('\n'), tabs: [], tab: null })
    } catch (e) {
      Object.assign(commandResult, { open: true, pane: null, cmd: label(), text: (e as Error).message, tabs: [], tab: null })
    } finally { emit('refresh') }
  } finally { busy.value = false }
}
const items = (): MenuItem[] => [{ label: label(), icon: 'i-lucide-archive', disabled: unavailable.value, run: archive }]
</script>

<template>
  <SpaceMenu :items="items" :title="repo" size="sm" :label="tl(`Repository options: ${repo}`, `Options du dépôt : ${repo}`)" />
</template>
