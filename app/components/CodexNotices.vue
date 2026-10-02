<script setup lang="ts">
// Codex notices above the input field (see shared/codexStatus.ts), in the
// style of Claude Code's "Update installed · Restart to update":
// - new Codex version: release notes, Update (runs Codex's official command
//   on the agent's machine, after confirmation) or Copy command, then
//   "Restart to update" (same restart flow as Claude: same conversation);
// - weekly limit at 25 % or less: what is left, its reset, and /status.
// "Hide" lasts until the next version, on this device.
import type { Pane } from '#shared/types'
import { machineOf } from '#shared/ids'
import { resetText } from '~/utils/quotas'

const props = defineProps<{ pane: Pane, paneId: string, readOnly: boolean }>()

const DISMISS_KEY = 'wherdr.codexUpdate.dismissed'
const dismissed = ref('')
try { dismissed.value = localStorage.getItem(DISMISS_KEY) || '' } catch { /* storage unavailable */ }

const update = computed(() => {
  const u = props.pane.codexStatus?.update
  if (!u) return null
  // Hidden version: only while nothing is in progress or to report.
  if (u.state === 'available' && !u.job && u.latest === dismissed.value) return null
  return u
})
const weekly = computed(() => props.pane.codexStatus?.weekly || null)
const job = computed(() => update.value?.job || null)
const machine = computed(() => {
  const key = machineOf(props.pane.id)
  const m = herdrState.value.machines?.find(m => m.key === key)
  return (m && m.label) || hostLabel.value || t('This machine')
})
const weeklyReset = computed(() => {
  const w = weekly.value
  if (!w || !w.resetsAt) return ''
  return resetText({ used: 100 - w.left, resetsAt: w.resetsAt, minutes: 10080 }, quotaNow.value, language) || ''
})

const availableText = computed(() => {
  const u = update.value
  if (!u) return ''
  const head = tl(`Codex ${u.latest} available`, `Codex ${u.latest} disponible`)
  return u.current ? `${head} ${tl(`(you have ${u.current})`, `(tu as la ${u.current})`)}` : head
})
const weeklyText = computed(() => {
  const w = weekly.value
  if (!w) return ''
  const head = tl(`Weekly limit: ${w.left}% left`, `Limite hebdo : ${w.left} % restants`)
  return weeklyReset.value ? `${head} · ${tl(`resets ${weeklyReset.value}`, `remise à zéro ${weeklyReset.value}`)}` : head
})

function hide() {
  const v = update.value?.latest
  if (!v) return
  dismissed.value = v
  try { localStorage.setItem(DISMISS_KEY, v) } catch { /* storage unavailable */ }
}

async function copy() {
  const c = update.value?.command
  if (!c) return
  haptic()
  try {
    await navigator.clipboard.writeText(c)
    toast(tl(`Command copied: paste it into a terminal on ${machine.value}.`, `Commande copiée : colle-la dans un terminal sur ${machine.value}.`))
  } catch { toast(t('Copy failed'), true) }
}

async function runUpdate() {
  const u = update.value
  if (!u || !u.runnable || !u.command) return
  const ok = await askConfirm([
    tl(`Update Codex to ${u.latest} on ${machine.value}?`, `Mettre à jour Codex en ${u.latest} sur ${machine.value} ?`),
    tl('wherdr will run Codex’s official update command there:', 'wherdr y lancera la commande de mise à jour officielle de Codex :'),
    u.command,
    tl('Running Codex agents keep their version until they are restarted; you can then restart this one on the same conversation.', 'Les Codex en cours gardent leur version jusqu’à leur redémarrage ; tu pourras ensuite redémarrer celui-ci sur la même conversation.'),
  ].join('\n\n'), t('Update'), 'primary')
  if (!ok) return
  haptic()
  try { await api('/api/codex-update', { pane_id: props.paneId }) }
  catch (err) { toast((err as Error).message, true) }
}

async function dismissJob() {
  try { await api('/api/codex-update', { pane_id: props.paneId, dismiss: true }) }
  catch (err) { toast((err as Error).message, true) }
}

// /status: Codex's own breakdown, shown like the + menu's commands.
async function status() {
  try {
    await api('/api/prompt', { pane_id: props.paneId, text: '/status' })
    haptic()
  } catch (err) { return toast((err as Error).message, true) }
  showCommandResult(props.paneId, '/status')
}
</script>

<template>
  <div v-if="update && job?.phase === 'running'" class="composer-notice restart" role="status">
    <span class="notice-spin" aria-hidden="true" />
    <span class="restart-text">{{ tl(`Updating Codex on ${machine}…`, `Mise à jour de Codex sur ${machine}…`) }}</span>
  </div>
  <div v-else-if="update && job?.phase === 'failed'" class="composer-notice failed" role="status">
    <span class="restart-text">{{ t('Codex update failed') }}{{ tl(': ', ' : ') }}{{ t(job.error) }}</span>
    <button v-if="update.command" type="button" class="notice-btn" @click="copy"><UIcon name="i-lucide-copy" />{{ t('Copy command') }}</button>
    <button type="button" class="notice-btn" @click="dismissJob">{{ t('Hide') }}</button>
  </div>
  <div v-else-if="update && update.state === 'installed'" class="composer-notice" role="status">
    <span class="restart-text">{{ tl(`Codex ${update.latest} installed`, `Codex ${update.latest} installé`) }} ·</span>
    <button
      type="button" class="notice-btn" :disabled="readOnly || !canRestart(pane)"
      :title="tl('Restarts Codex in this pane on the same conversation (codex resume)', 'Relance Codex dans ce panneau sur la même conversation (codex resume)')"
      @click="restartAgent(pane)"
    >
      <UIcon name="i-lucide-rotate-cw" />{{ t('Restart to update') }}
    </button>
  </div>
  <div v-else-if="update" class="composer-notice codex-update" role="status">
    <span class="restart-text" :title="availableText">{{ tl(`Codex ${update.latest} available`, `Codex ${update.latest} disponible`) }}<span v-if="update.current" class="notice-extra">{{ ' ' }}{{ tl(`(you have ${update.current})`, `(tu as la ${update.current})`) }}</span> ·</span>
    <a class="notice-btn" :href="update.notes" target="_blank" rel="noopener noreferrer" :aria-label="t('Release notes')" :title="t('Release notes')">
      <UIcon name="i-lucide-external-link" /><span class="notice-label">{{ t('Release notes') }}</span>
    </a>
    <button v-if="update.runnable" type="button" class="notice-btn" :disabled="readOnly" @click="runUpdate">
      <UIcon name="i-lucide-circle-arrow-up" />{{ t('Update') }}
    </button>
    <button v-else-if="update.command" type="button" class="notice-btn" @click="copy"><UIcon name="i-lucide-copy" />{{ t('Copy command') }}</button>
    <button type="button" class="notice-btn notice-x" :aria-label="t('Hide until the next version')" :title="t('Hide until the next version')" @click="hide">
      <UIcon name="i-lucide-x" />
    </button>
  </div>
  <div v-if="weekly" class="composer-notice codex-weekly" :class="{ low: weekly.left <= 10 }" role="status">
    <UIcon name="i-lucide-triangle-alert" class="notice-icon" />
    <span class="restart-text" :title="weeklyText">{{ tl(`Weekly limit: ${weekly.left}% left`, `Limite hebdo : ${weekly.left} % restants`) }}<template v-if="weeklyReset">{{ ' · ' }}<span class="notice-extra">{{ tl('resets ', 'remise à zéro ') }}</span>{{ weeklyReset }}</template></span>
    <button type="button" class="notice-btn" :disabled="readOnly" :title="t('Show Codex’s usage breakdown')" @click="status">/status</button>
  </div>
</template>
