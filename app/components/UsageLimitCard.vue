<script setup lang="ts">
import type { UsageLimit } from '#shared/usageLimit'
import { tl } from '~/utils/i18n'
const props = defineProps<{ limit: UsageLimit, readOnly: boolean, sendKeys: (keys: string[]) => Promise<void> }>()
const emit = defineEmits<{ credits: [] }>()
const busy = ref(false)
async function cancel() {
  if (props.readOnly || busy.value) return
  busy.value = true
  try { await props.sendKeys(['esc']) }
  catch (err) { toast((err as Error).message, true) }
  finally { busy.value = false }
}
</script>

<template>
  <div class="usage-limit-card composer-notice" role="status">
    <span class="restart-text">
      {{ tl('Provider quota reached', 'Quota fournisseur atteint') }}<template v-if="limit.resets"> · {{ tl('Resets', 'Réinitialisation') }} {{ limit.resets }}</template>
      <small v-if="limit.automatic">{{ tl('Will continue automatically', 'Reprise automatique') }}</small>
    </span>
    <button v-if="limit.automatic" type="button" class="notice-btn" :disabled="readOnly || busy" @click="cancel">{{ tl('Cancel wait', 'Annuler l’attente') }}</button>
    <button v-if="limit.credits" type="button" class="notice-btn" :disabled="readOnly || busy" @click="emit('credits')">/usage-credits</button>
    <a v-if="limit.resetLink" class="notice-btn" href="https://clau.de/reset" target="_blank" rel="noopener noreferrer">{{ tl('Reset quota ↗', 'Réinitialiser le quota ↗') }}</a>
  </div>
</template>

<style scoped>
.usage-limit-card { flex-wrap: wrap; border-top: 1px solid var(--line); padding-top: 8px; white-space: normal; text-align: left; justify-content: flex-start; color: var(--ochre); }
.restart-text small { display: block; color: var(--muted); }
</style>
