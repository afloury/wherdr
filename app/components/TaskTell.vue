<script setup lang="ts">
// A reply to a task whose agent has no pane: herdr-projects passes it on
// (`tell`). Under its recorded conversation once its agent has exited, or
// alone (BoardPanel).
import { TELL_MAX } from '#shared/projectsTasks'

defineProps<{ toReviewer: boolean, plan: boolean, reachable?: boolean, machineLabel: string, telling: boolean }>()
const emit = defineEmits<{ send: [] }>()
const reply = defineModel<string>({ required: true })
</script>

<template>
  <form class="board-panel-first board-panel-tell" @submit.prevent="emit('send')">
    <label for="board-panel-tell">{{ toReviewer
      ? tl('The reviewer is waiting for an answer: herdr-projects passes your reply on to it.', 'Le relecteur attend une réponse : herdr-projects lui transmet ta réponse.')
      : plan
      ? tl('Its agent is not running now: your words send the plan back, through herdr-projects.', 'Son agent ne tourne pas en ce moment : tes mots renvoient le plan, par herdr-projects.')
      : tl('Its agent is not running now: herdr-projects passes your reply on.', 'Son agent ne tourne pas en ce moment : herdr-projects lui transmet ta réponse.') }}</label>
    <p v-if="!reachable" class="board-panel-away" role="status">
      {{ tl(`${machineLabel} cannot be reached now.`, `${machineLabel} est injoignable pour l’instant.`) }}
    </p>
    <UTextarea id="board-panel-tell" v-model="reply" :rows="3" autoresize :maxlength="TELL_MAX" :placeholder="tl('Message', 'Message')" :disabled="offlineView" />
    <UButton type="submit" color="primary" icon="i-lucide-send" :loading="telling" :disabled="!reply.trim() || offlineView || !reachable">{{ t('Send') }}</UButton>
  </form>
</template>
