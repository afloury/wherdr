<script setup lang="ts">
// A coordinator's autopilot: its switch, whether it is active or asleep
// (nothing to do: its scheduled wakes are skipped), today's counters against
// the limits, its goal, interval, fixed times, events and limits (saved by the user
// only), its latest wakes (created, delivered, acked) and "run now". In the coordinator window.
import { AUTOPILOT_EVENTS, DEFAULT_AUTOPILOT, LOOK_PER_DAY, type Autopilot, type AutopilotEvent } from '#shared/pm/autopilot'
import type { CoordinatorView } from '#shared/pm/coordinator'
import type { Wake } from '#shared/pm/wakes'

const props = defineProps<{ c: CoordinatorView }>()
const ap = computed<Autopilot>(() => props.c.autopilot ?? DEFAULT_AUTOPILOT)
const busy = ref(false)
const error = ref('')
const sent = ref(false)
const form = reactive({ goal: '', every: '', at: '', events: [] as AutopilotEvent[], perDay: 0, atOnce: 0, lookForWork: false, lookPerDay: LOOK_PER_DAY })
const fill = () => Object.assign(form, { goal: ap.value.goal, every: ap.value.every ?? '', at: ap.value.at ?? '', events: [...ap.value.events], perDay: ap.value.perDay, atOnce: ap.value.atOnce, lookForWork: !!ap.value.lookForWork, lookPerDay: ap.value.lookPerDay ?? LOOK_PER_DAY })
watch(ap, fill, { immediate: true })

const EVENT_LABEL: Record<AutopilotEvent, [string, string]> = {
  added: ['Task added', 'Tâche ajoutée'], done: ['Task done', 'Tâche finie'], stuck: ['Task stuck', 'Tâche bloquée'], ready: ['Ready for you', 'Prête pour toi'],
}
const toggleEvent = (e: AutopilotEvent) => { form.events = form.events.includes(e) ? form.events.filter(x => x !== e) : [...form.events, e] }

async function act(fn: () => Promise<unknown>) {
  busy.value = true
  error.value = ''
  try { await fn(); await loadCoordinators() }
  catch (e) { error.value = (e as Error).message }
  finally { busy.value = false }
}
const save = (more: Partial<Autopilot> = {}) => act(() => {
  const { lookForWork: _, lookPerDay: __, ...kept } = ap.value
  return api('/api/pm/autopilot', {
    project: props.c.project,
    autopilot: { ...kept, goal: form.goal, every: form.every.trim(), at: form.at.trim(), events: form.events, perDay: Number(form.perDay), atOnce: Number(form.atOnce), ...(form.lookForWork ? { lookForWork: true, lookPerDay: Number(form.lookPerDay) } : {}), ...more },
  })
})
// The switch keeps the saved settings: only what Save sent counts.
const setOn = (on: boolean) => act(() => api('/api/pm/autopilot', { project: props.c.project, autopilot: { ...ap.value, on } }))
const runNow = () => act(async () => { await api('/api/pm/autopilot', { project: props.c.project, runNow: true }); sent.value = true })

const time = (at?: number) => (at ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—')
// Its last wake: the time today, else the day too.
const when = (at: number) => (new Date(at).toDateString() === new Date().toDateString() ? time(at) : new Date(at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))
const stateText = computed(() => {
  if (!ap.value.on) return tl('Off', 'Arrêté')
  if (!props.c.asleep) return tl('Active', 'Actif')
  const woke = props.c.wokeAt ? tl(` · woke ${when(props.c.wokeAt)}`, ` · réveillé ${when(props.c.wokeAt)}`) : ''
  return props.c.asleep === 'limit'
    ? tl(`Asleep · new work limit reached until tomorrow${woke}`, `Endormi · limite de travail nouveau atteinte jusqu’à demain${woke}`)
    : tl(`Asleep · nothing to do${woke}`, `Endormi · rien à faire${woke}`)
})
const ENDED: Record<NonNullable<Wake['ended']>, [string, string]> = {
  ack: ['Acked', 'Accusé'], idle: ['Ended idle', 'Fini inactif'], quit: ['Coordinator quit', 'Coordinateur parti'], timeout: ['Timed out', 'Expiré'],
  unanswered: ['No answer', 'Sans réponse'], merged: ['Merged into the next', 'Fusionné au suivant'],
}
// The wake's state: waiting, delivered (its turn), acked, or how it ended.
const wakeState = (w: Wake) => (w.ackedAt ? 'ack' : w.ended ?? (w.deliveredAt ? 'delivered' : 'pending'))
const stateLabel = (w: Wake) => {
  const s = wakeState(w)
  return s === 'pending' ? tl('Waiting', 'En attente') : s === 'delivered' ? tl('Delivered', 'Livré') : tl(...ENDED[s as keyof typeof ENDED])
}
const counters = computed(() => props.c.limits
  ? tl(`${props.c.limits.started}/${props.c.limits.perDay} today · ${props.c.limits.working}/${props.c.limits.atOnce} at once`, `${props.c.limits.started}/${props.c.limits.perDay} aujourd’hui · ${props.c.limits.working}/${props.c.limits.atOnce} en parallèle`)
  : '')
</script>

<template>
  <section class="ap" data-testid="coordinator-autopilot">
    <div class="ap-head">
      <USwitch :model-value="ap.on" color="success" size="lg" :disabled="busy" :aria-label="tl('Autopilot', 'Autopilote')" data-testid="autopilot-on" @update:model-value="setOn" />
      <span class="mono-label" data-testid="autopilot-state" :data-asleep="ap.on && c.asleep ? '' : undefined">{{ tl('Autopilot', 'Autopilote') }} · {{ stateText }}</span>
      <span class="ap-count mono-label" data-testid="autopilot-counters">{{ counters }}</span>
    </div>
    <form class="ap-form" @submit.prevent="save()">
      <label class="field-label" :for="`ap-goal-${c.project}`">{{ tl('Goal', 'Objectif') }}</label>
      <UTextarea :id="`ap-goal-${c.project}`" v-model="form.goal" :rows="2" autoresize :maxrows="6" size="xl" class="w-full" :maxlength="2000" data-testid="autopilot-goal"
        :placeholder="tl('What it works toward, e.g. Ship the small fixes first', 'Ce vers quoi il travaille, ex. Les petites corrections d’abord')" />
      <div class="ap-grid">
        <div>
          <label class="field-label" :for="`ap-every-${c.project}`">{{ tl('Every', 'Fréquence') }}</label>
          <UInput :id="`ap-every-${c.project}`" v-model="form.every" size="xl" class="w-full mono" placeholder="2h" maxlength="5" autocapitalize="none" autocorrect="off" :spellcheck="false" data-testid="autopilot-every" />
        </div>
        <div>
          <label class="field-label" :for="`ap-at-${c.project}`">{{ tl('At', 'À') }}</label>
          <UInput :id="`ap-at-${c.project}`" v-model="form.at" size="xl" class="w-full mono" placeholder="daily 08:00" maxlength="60" autocapitalize="none" autocorrect="off" :spellcheck="false" data-testid="autopilot-at" />
        </div>
        <div>
          <label class="field-label" :for="`ap-day-${c.project}`">{{ tl('Tasks / day', 'Tâches / jour') }}</label>
          <UInput :id="`ap-day-${c.project}`" v-model="form.perDay" type="number" min="0" max="100" inputmode="numeric" size="xl" class="w-full mono" data-testid="autopilot-per-day" />
        </div>
        <div>
          <label class="field-label" :for="`ap-once-${c.project}`">{{ tl('At once', 'En parallèle') }}</label>
          <UInput :id="`ap-once-${c.project}`" v-model="form.atOnce" type="number" min="0" max="20" inputmode="numeric" size="xl" class="w-full mono" data-testid="autopilot-at-once" />
        </div>
      </div>
      <span class="field-label">{{ tl('Wakes on', 'Réveillé quand') }}</span>
      <div class="ap-events" role="group">
        <UButton v-for="e in AUTOPILOT_EVENTS" :key="e" type="button" size="lg" :color="form.events.includes(e) ? 'primary' : 'neutral'" :variant="form.events.includes(e) ? 'solid' : 'outline'"
          :aria-pressed="form.events.includes(e)" :data-testid="`autopilot-event-${e}`" @click="toggleEvent(e)">
          {{ tl(...EVENT_LABEL[e]) }}
        </UButton>
      </div>
      <USwitch v-model="form.lookForWork" size="lg" :label="tl('Look for new work', 'Chercher du travail')" data-testid="autopilot-look-for-work"
        :description="tl('Keep the scheduled wakes when there is nothing to do, for a goal that adds its own tasks.', 'Garder les réveils programmés quand il n’y a rien à faire, pour un objectif qui crée ses propres tâches.')" />
      <div v-if="form.lookForWork" class="ap-grid">
        <div>
          <label class="field-label" :for="`ap-look-${c.project}`">{{ tl('New tasks / day', 'Tâches nouvelles / jour') }}</label>
          <UInput :id="`ap-look-${c.project}`" v-model="form.lookPerDay" type="number" min="0" max="20" inputmode="numeric" size="xl" class="w-full mono" data-testid="autopilot-look-per-day" />
        </div>
        <p class="muted ap-look-note">{{ tl('Added by those wakes; once reached, it sleeps until tomorrow.', 'Ajoutées par ces réveils ; une fois atteint, il dort jusqu’à demain.') }}</p>
      </div>
      <div class="ap-actions">
        <UButton type="submit" color="primary" size="lg" :loading="busy" data-testid="autopilot-save">{{ t('Save') }}</UButton>
      </div>

      <div class="ap-actions">
        <span class="mono-label">{{ tl('Wakes', 'Réveils') }}</span>
        <UButton type="button" color="neutral" variant="outline" size="lg" icon="i-lucide-play" :disabled="busy || !c.terminal" data-testid="autopilot-run-now" @click="runNow">{{ tl('Run now', 'Lancer maintenant') }}</UButton>
      </div>
      <p v-if="!c.terminal" class="muted">{{ tl('Start the coordinator to wake it.', 'Lance le coordinateur pour le réveiller.') }}</p>
      <p v-else-if="sent" class="muted" role="status">{{ tl('Queued: it goes as soon as the coordinator is idle.', 'En file : il part dès que le coordinateur est inactif.') }}</p>
      <ol v-if="c.wakes?.length" class="ap-wakes" data-testid="autopilot-wakes">
        <li v-for="w in c.wakes" :key="w.id" :data-state="wakeState(w)" data-testid="autopilot-wake">
          <span class="ap-wake-head"><b class="mono-label">{{ w.id }}</b><span class="ap-state" :class="wakeState(w)">{{ stateLabel(w) }}</span></span>
          <small class="mono-label muted">{{ tl('Created', 'Créé') }} {{ time(w.createdAt) }} · {{ tl('Delivered', 'Livré') }} {{ time(w.deliveredAt) }} · {{ tl('Acked', 'Accusé') }} {{ time(w.ackedAt) }}<template v-if="w.tries > 1"> · ×{{ w.tries }}</template></small>
          <span class="ap-reason">{{ w.reasons[0] }}<template v-if="w.reasons.length > 1"> (+{{ w.reasons.length - 1 }})</template></span>
        </li>
      </ol>
      <p v-else class="muted">{{ tl('No wake yet.', 'Aucun réveil pour l’instant.') }}</p>
    </form>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.ap { display: grid; gap: 6px; padding-top: 12px; border-top: 1px solid var(--line); }
.ap p { margin: 0; overflow-wrap: anywhere; }
.ap-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.ap-head > .mono-label:not(.ap-count) { color: var(--text); }
.ap-count { flex: 1; color: var(--muted); white-space: nowrap; }
.ap-look-note { align-self: end; }
.ap-form { display: grid; gap: 6px; }
.ap-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.ap-events, .ap-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.ap-actions .mono-label { flex: 1; color: var(--muted); }
.ap-wakes { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); }
.ap-wakes li { display: grid; gap: 2px; padding: 6px 0; border-bottom: 1px solid var(--line-soft); }
.ap-wake-head { display: flex; justify-content: space-between; gap: 8px; }
.ap-state { font: 12px/1.4 var(--font-mono); text-transform: uppercase; letter-spacing: .08em; padding: 0 6px; border: 1px solid var(--line); }
.ap-state.ack { color: var(--green); }
.ap-state.delivered { color: var(--accent); }
.ap-state.unanswered, .ap-state.timeout { color: var(--rose); }
.ap-reason { color: var(--text-2); overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
</style>
