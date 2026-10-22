<script setup lang="ts">
// A herdr-projects repo in wherdr's list (app/components/ProjectGroup.vue):
// its coordinator's row (the wherdr mark on the accent, the repo's name,
// COORDINATOR, its state), the group's bar (fold, summary of the tasks,
// branch), then its tasks, one line each, on a rule hanging from the fold.
import { projectSummary } from '~/utils/demoScript'
import type { DemoProject } from '~/utils/demoScript'

const props = defineProps<{ project: DemoProject, active?: string, choices?: readonly string[], choicesFor?: string, hit?: number }>()
const summary = computed(() => projectSummary(props.project.tasks))
</script>

<template>
  <section class="project">
    <div class="card-list">
      <div class="card compact home-lead" :class="[project.coordinator, { sel: active === project.repo }]">
        <span class="avatar lead-mark"><PixelMark :boot="false" :glow="false" /></span>
        <span class="card-title lead-name">{{ project.repo }}</span>
        <span class="card-tag lead-coord-tag">Coordinator</span>
        <span class="card-state" :class="project.coordinator"><i /></span>
      </div>
    </div>
    <div class="project-bar">
      <span class="project-head">
        <UIcon name="i-lucide-chevron-down" class="project-chev" />
        <span class="project-sum"><template v-for="(p, i) in summary" :key="p.key"><span :class="`project-sum-${p.key}`">{{ p.text }}</span><span v-if="i < summary.length - 1" class="project-sum-sep">·</span></template></span>
      </span>
      <span v-if="project.branch" class="project-branch"><UIcon name="i-lucide-git-branch" />{{ project.branch }}</span>
    </div>
    <div class="card-list project-tree">
      <DemoAgentCard
        v-for="t in project.tasks" :key="t.tag" :agent="t" :selected="active === t.name"
        :choices="choicesFor === t.name ? choices : undefined" :hit="hit"
      />
    </div>
  </section>
</template>
