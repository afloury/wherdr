<script setup lang="ts">
// One row of the Board settings screen: the value herdr-projects resolves, where
// it comes from (as the task sheet's settings, #163), ↺ to go back to the
// inherited value (`unset`), and Change. What Change offers comes from the
// machine: the agents installed there, the models and efforts `herdr-projects
// models <program>` lists, the choices herdr-projects documents; anything else
// is typed. `change` resolves true once herdr-projects took it (the screen
// then shows its settings as read again).
import { canReset, modelOf, programOf, settingChoice, settingText } from '#shared/boardSettings'
import { effortsFor, type StartModels } from '#shared/projectsTasks'
import type { TaskSetting } from '#shared/taskSettings'
import { boardSettingLabel } from '~/utils/boardSettings'
import { taskSettingSource } from '~/utils/taskSettings'

const props = defineProps<{
  row: TaskSetting, machine: string, repo?: string, agents: string[], rows: TaskSetting[], busy?: boolean, error?: string, disabled?: boolean,
  change: (value: string | null) => Promise<boolean>
}>()

const DEFAULT = '__default'
const choice = computed(() => settingChoice(props.row.name, props.row.value))
const current = computed(() => settingText(props.row.value))
const editing = ref(false)
const draft = ref('')
const program = ref('')
const model = ref(DEFAULT)
const typedModel = ref('')

// The agent an effort is checked against: the same role's agent, as resolved here.
const effortAgent = computed(() => {
  const c = choice.value
  return c.type === 'effort' ? settingText(props.rows.find(r => r.name === c.agent)?.value) : ''
})
const modelsOf = computed(() => (choice.value.type === 'agent' ? program.value : choice.value.type === 'effort' ? programOf(effortAgent.value) : ''))
const models = ref<StartModels | null>(null)
const modelsLoading = ref(false)
const modelsFailed = ref(false)
let seq = 0
async function loadModels(p: string) {
  const n = ++seq
  models.value = null
  modelsFailed.value = false
  if (!p || p === 'none') return
  modelsLoading.value = true
  try {
    const r = await api<StartModels>(`/api/tasks/models?machine=${encodeURIComponent(props.machine)}&program=${encodeURIComponent(p)}`)
    if (n === seq) models.value = r
  } catch { if (n === seq) modelsFailed.value = true }
  finally { if (n === seq) modelsLoading.value = false }
}
watch(() => (editing.value ? modelsOf.value : ''), p => { if (p) loadModels(p) })

const withCurrent = (values: string[], now: string) => (now && !values.includes(now) ? [now, ...values] : values)
const programItems = computed(() => {
  const c = choice.value
  const listed = withCurrent([...props.agents], programOf(current.value) === 'none' ? '' : programOf(current.value))
  return [...(c.type === 'agent' && c.none ? [{ label: 'none', value: 'none' }] : []), ...listed.map(a => ({ label: a, value: a }))]
})
const modelItems = computed(() => {
  const listed = withCurrent(models.value?.models ?? [], programOf(current.value) === program.value ? modelOf(current.value) : '')
  return [{ label: tl('Program’s default', 'Modèle par défaut du programme'), value: DEFAULT }, ...listed.map(m => ({ label: m, value: m }))]
})
// No list read: the model is typed (herdr-projects checks it).
const typeModel = computed(() => !modelsLoading.value && program.value !== 'none' && (modelsFailed.value || (models.value !== null && !models.value.models.length)))
const effortItems = computed(() => {
  const m = models.value
  const agentModel = modelOf(effortAgent.value)
  const levels = m ? (agentModel ? effortsFor(m, agentModel) : m.efforts) : []
  return withCurrent(['default', ...levels], current.value).map(v => ({ label: v, value: v }))
})
const pickItems = computed(() => {
  const c = choice.value
  const values = c.type === 'pick' ? c.values : c.type === 'switch' ? ['true', 'false'] : []
  return withCurrent(values, current.value).map(v => ({ label: v, value: v }))
})

function edit() {
  draft.value = current.value
  program.value = programOf(current.value) || props.agents[0] || ''
  model.value = modelOf(current.value) || DEFAULT
  typedModel.value = modelOf(current.value)
  editing.value = true
}
watch(program, (p, was) => { if (was && p !== was) { model.value = DEFAULT; typedModel.value = '' } })
// What Save sends.
const value = computed(() => {
  if (choice.value.type !== 'agent') return draft.value.trim()
  if (!program.value || program.value === 'none') return program.value
  const m = typeModel.value ? typedModel.value.trim() : model.value === DEFAULT ? '' : model.value
  return m ? `${program.value}/${m}` : program.value
})
const canSave = computed(() => Boolean(value.value) && value.value !== current.value && !props.busy && !props.disabled)
async function save() {
  if (!canSave.value) return
  if (await props.change(value.value)) editing.value = false
}
async function reset() {
  if (props.busy || props.disabled) return
  if (await props.change(null)) editing.value = false
}
const fieldId = computed(() => `bs-${props.row.name.replace('.', '-')}`)
</script>

<template>
  <div class="bs-row" :class="{ editing, own: canReset(row) }" :data-setting="row.name">
    <div class="bs-head">
      <p class="bs-name">{{ boardSettingLabel(row.name) }}<small class="bs-key">{{ row.name }}</small></p>
      <div class="bs-actions">
        <UButton
          v-if="canReset(row)" icon="i-lucide-rotate-ccw" color="neutral" variant="ghost" size="sm" class="icon-btn bs-reset"
          :disabled="busy || disabled" :loading="busy && !editing"
          :aria-label="tl(`Back to the inherited value: ${row.name}`, `Revenir à la valeur héritée : ${row.name}`)"
          :title="tl('Back to the inherited value', 'Revenir à la valeur héritée')" @click="reset"
        />
        <UButton v-if="!editing" color="neutral" variant="outline" size="sm" class="bs-edit" :disabled="disabled" @click="edit">{{ tl('Change', 'Modifier') }}</UButton>
      </div>
    </div>
    <p class="bs-value">{{ current || tl('(empty)', '(vide)') }}</p>
    <p class="bs-origin">
      <span class="bs-source" :class="{ own: canReset(row) }">{{ taskSettingSource(row.place) }}</span>
      <span v-if="row.from">{{ row.from }}</span>
      <span v-if="row.note" class="bs-note">{{ row.note }}</span>
    </p>
    <form v-if="editing" class="bs-editor" @submit.prevent="save">
      <template v-if="choice.type === 'agent'">
        <label :for="`${fieldId}-program`">{{ tl('Program', 'Programme') }}</label>
        <USelect :id="`${fieldId}-program`" v-model="program" :items="programItems" size="md" class="bs-field" />
        <template v-if="program && program !== 'none'">
          <label :for="`${fieldId}-model`">{{ tl('Model', 'Modèle') }}</label>
          <p v-if="modelsLoading" class="bs-hint">{{ tl('Reading models…', 'Lecture des modèles…') }}</p>
          <UInput v-else-if="typeModel" :id="`${fieldId}-model`" v-model="typedModel" size="md" class="bs-field" :placeholder="tl('Program’s default', 'Modèle par défaut du programme')" />
          <USelect v-else :id="`${fieldId}-model`" v-model="model" :items="modelItems" size="md" class="bs-field" />
          <p v-if="typeModel" class="bs-hint">{{ tl('herdr-projects did not list models for this program here: type one, or leave it empty.', 'herdr-projects n’a pas listé de modèles pour ce programme ici : tape un nom, ou laisse vide.') }}</p>
        </template>
      </template>
      <template v-else-if="choice.type === 'effort'">
        <label :for="`${fieldId}-v`">{{ tl(`Effort for ${effortAgent || '?'}`, `Effort pour ${effortAgent || '?'}`) }}</label>
        <p v-if="modelsLoading" class="bs-hint">{{ tl('Reading efforts…', 'Lecture des efforts…') }}</p>
        <USelect v-else :id="`${fieldId}-v`" v-model="draft" :items="effortItems" size="md" class="bs-field" />
      </template>
      <USelect v-else-if="choice.type === 'switch' || choice.type === 'pick'" :id="`${fieldId}-v`" v-model="draft" :items="pickItems" size="md" class="bs-field" :aria-label="row.name" />
      <UTextarea v-else-if="choice.long" :id="`${fieldId}-v`" v-model="draft" :rows="4" autoresize :maxrows="12" class="bs-field" :aria-label="row.name" />
      <UInput v-else :id="`${fieldId}-v`" v-model="draft" size="md" class="bs-field" :aria-label="row.name" />
      <p class="bs-preview">{{ tl('Sends', 'Envoie') }} · <code>herdr-projects set {{ row.name }} {{ value || '…' }}{{ repo ? ` --repo ${repo}` : '' }}</code></p>
      <div class="bs-buttons">
        <UButton color="neutral" variant="ghost" size="sm" :disabled="busy" @click="editing = false">{{ t('Cancel') }}</UButton>
        <UButton type="submit" color="primary" variant="solid" size="sm" class="hw-cta bs-save" :disabled="!canSave" :loading="busy">{{ tl('Save', 'Enregistrer') }}</UButton>
      </div>
    </form>
    <p v-if="error" class="board-note error bs-error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.bs-row { padding: 12px 0; border-top: 1px solid var(--line); min-width: 0; overflow-wrap: anywhere; }
.bs-head { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
.bs-name { flex: 1; min-width: 0; margin: 0; font-size: 13.5px; font-weight: 600; color: var(--text); }
.bs-key { display: block; margin-top: 3px; font: 400 11px/1.3 var(--mono); color: var(--muted); }
.bs-actions { flex: none; display: flex; align-items: center; gap: 4px; }
.bs-actions :deep(button) { border-radius: 0; }
.bs-value { margin: 6px 0 0; font: 13px/1.45 var(--mono); color: var(--text); white-space: pre-wrap; }
.bs-origin { margin: 6px 0 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; font-size: 12px; color: var(--muted); }
.bs-source { border: 1px solid var(--line); padding: 2px 6px; font: 500 10.5px/1.2 var(--mono); letter-spacing: .08em; text-transform: uppercase; }
.bs-source.own { color: var(--accent); border-color: var(--accent); }
.bs-editor { margin-top: 10px; padding: 10px; display: grid; gap: 6px; border: 1px solid var(--line-strong); background: var(--bg-2); }
.bs-editor label { font: 600 10.5px/1.2 var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.bs-field { width: 100%; }
.bs-hint { margin: 0; font-size: 12px; color: var(--muted); }
.bs-preview { margin: 4px 0 0; font-size: 11.5px; color: var(--muted); }
.bs-preview code { font-family: var(--mono); overflow-wrap: anywhere; }
.bs-buttons { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
.bs-buttons :deep(button) { border-radius: 0; }
.bs-error { margin: 8px 0 0; white-space: pre-wrap; }
/* iOS zooms on a field under 16 px. */
@media (pointer: coarse) { .bs-editor :deep(input), .bs-editor :deep(textarea), .bs-editor :deep(button) { font-size: 16px; } }
</style>
