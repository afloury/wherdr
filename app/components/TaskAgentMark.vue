<script setup lang="ts">
import type { TaskAgentIdentity } from '#shared/projectsTasks'
defineProps<{ identity?: TaskAgentIdentity, primary?: boolean }>()
</script>

<template>
  <span v-if="identity && ((primary && identity.agent) || identity.reviewer || identity.from)" class="task-agent-mark">
    <span v-if="primary && identity.agent" class="task-agent-primary"><AgentAvatar :agent="identity.agent" />{{ kindLabel(identity.agent) }}</span>
    <span v-if="identity.reviewer" class="task-agent-reviewer" :aria-label="tl(`Reviewed by ${kindLabel(identity.reviewer)}`, `Relu par ${kindLabel(identity.reviewer)}`)">{{ tl('Reviewed by', 'Relu par') }} <AgentAvatar :agent="identity.reviewer" /><span>{{ kindLabel(identity.reviewer) }}</span></span>
    <span v-if="identity.from" class="task-agent-from">{{ tl('Took over from', 'A pris le relais de') }} <AgentAvatar :agent="identity.from" /><span>{{ kindLabel(identity.from) }}</span></span>
  </span>
</template>
