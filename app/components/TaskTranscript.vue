<script setup lang="ts">
// A finished task's conversation in the Board's panel (Agent or Reviewer tab):
// its agent has exited, so no pane runs it any more; the board recorded its
// session (task.json `session`, `reviewSession`) and the conversation is read
// from there, read only (ChatView `source`). `gotoTerm`: its pane's leftover
// shell, when it still has one.
import type { Pane } from '#shared/types'
import type { TaskRole } from '#shared/projectsTasks'

const props = defineProps<{ machine: string, id: string, role: TaskRole, agent: string }>()
const emit = defineEmits<{ gotoTerm: [] }>()

// What ChatView needs of a pane: the agent kind (how its messages read) and an
// id of its own (what this device keeps of it), never a real pane's id.
const pane = computed<Pane>(() => ({
  id: `task:${props.machine}|${props.id}|${props.role}`,
  workspace: '', tab: '', tabLabel: null, agent: props.agent, name: null, label: null,
  status: null, title: null, cwd: null, agentSession: null,
}))
const source = computed(() => ({ machine: props.machine, id: props.id, role: props.role }))
</script>

<template>
  <section class="cell-view active task-transcript" :data-role="role">
    <div class="agent-body">
      <div class="agent-main hw-backdrop-host">
        <div class="swipe-area">
          <ChatView :key="pane.id" :pane="pane" :local-queued="[]" :source="source" @goto-term="emit('gotoTerm')" />
        </div>
      </div>
    </div>
  </section>
</template>
