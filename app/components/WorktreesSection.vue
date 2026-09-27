<script setup lang="ts">
// Réglages : les worktrees Git des agents, à supprimer quand ils ne servent plus.
import type { WorktreeInfo } from '#shared/types'

onMounted(loadWorktrees)
const multi = computed(() => Boolean(herdrState.value.machines && herdrState.value.machines.length > 1))
const machineLabel = (k: string) => (herdrState.value.machines || []).find(m => m.key === k)?.label || hostLabel.value
function state(w: WorktreeInfo) {
  if (w.prunable) return t('dossier disparu')
  if (!w.workspace) return t('fermé')
  if (w.agents) return tl(`ouvert · ${w.agents} agent${w.agents > 1 ? 's' : ''}`, `open · ${w.agents} agent${w.agents > 1 ? 's' : ''}`)
  return t('ouvert')
}
const busy = ref<string | null>(null)
async function remove(w: WorktreeInfo) {
  busy.value = w.path
  await removeWorktreeFlow(w)
  busy.value = null
}
</script>

<template>
  <div class="settings-group">
    <h3>{{ t('Worktrees') }}</h3>
    <div class="settings-card wt-card">
      <p v-if="worktrees === null" class="muted"><span class="spinner" /></p>
      <p v-else-if="!worktrees.length" class="muted">{{ t('Aucun worktree.') }}</p>
      <ul v-else class="wt-list">
        <li v-for="w in worktrees" :key="`${w.machine}|${w.path}`" :class="{ open: w.workspace, gone: w.prunable }">
          <div class="wt-main">
            <b><UIcon name="i-lucide-git-branch" />{{ worktreeName(w) }}</b>
            <span class="wt-meta">{{ w.repo }}<template v-if="multi"> · {{ machineLabel(w.machine) }}</template> · <i>{{ state(w) }}</i></span>
            <span class="wt-path">{{ shortPath(w.path) }}</span>
          </div>
          <button type="button" class="wt-del" :disabled="busy === w.path" :aria-label="t('Supprimer')" @click="remove(w)">
            <span v-if="busy === w.path" class="spinner" /><UIcon v-else name="i-lucide-trash-2" />
          </button>
        </li>
      </ul>
      <p class="muted">{{ t('Supprimer un worktree efface son dossier ; la branche Git est gardée.') }}</p>
    </div>
  </div>
</template>
