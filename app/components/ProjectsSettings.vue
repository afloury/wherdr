<script setup lang="ts">
// Settings › Projects: the project management switch, the projects (a git
// folder on a machine herdr-core reaches), the template each one follows,
// whether its repository is public (checked by wherdr, or set by the user),
// each project's automations and the template editor.
// Off, the server refuses every change but the switch.
import type { PmOverview } from '#shared/pm/project'
import type { RepoVisibility } from '#shared/pm/visibility'

const props = defineProps<{ active: boolean }>()
const data = ref<PmOverview | null>(null)
const error = ref('')
const busy = ref('')
const form = reactive({ key: '', name: '', machine: '', path: '', base: '', template: '' })

const machineList = computed(() => machineChoices.value || [])
const machineName = (key: string) => key ? (appConfig.value.machines?.find(m => m.key === key)?.label || key) : (appConfig.value.hostLabel || t('This machine'))
const canAdd = computed(() => Boolean(form.key.trim() && form.path.trim()) && !busy.value)

async function load() {
  try { data.value = await api<PmOverview>('/api/pm/overview') }
  catch (e) { error.value = (e as Error).message }
}
watch(() => props.active, (on) => { if (on && !data.value) load() }, { immediate: true })

async function run(what: string, fn: () => Promise<unknown>) {
  if (busy.value) return
  busy.value = what
  error.value = ''
  try { await fn() }
  catch (e) { error.value = (e as Error).message }
  finally { busy.value = '' }
}
const toggle = (on: boolean) => run('switch', async () => { data.value = await api<PmOverview>('/api/pm/enabled', { enabled: on }) })
const add = () => run('add', async () => {
  const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim()]))
  await api('/api/pm/project', { ...body, machine: form.machine })
  toast(tl('Project added', 'Projet ajouté'))
  Object.assign(form, { key: '', name: '', path: '', base: '' })
  await load()
})
const pickTemplate = (key: string, template: string) => run(`tpl:${key}`, async () => {
  await api('/api/pm/project-template', { key, template })
  await load()
})
// The user's override (public or private), or wherdr's check again.
const setVisibility = (key: string, body: { value: string } | { check: true }) => run(`vis:${key}`, async () => {
  await api('/api/pm/project-visibility', { key, ...body })
  await load()
})
const visibilityNote = (v?: RepoVisibility) => !v ? tl('Not checked yet', 'Pas encore vérifié')
  : v.by === 'user' ? tl('Set by you', 'Choisi par vous')
  : `${v.value === 'unknown' ? tl('Not found', 'Introuvable') : tl('Checked', 'Vérifié')} ${new Date(v.at).toLocaleDateString()}`
const templateItems = computed(() => [{ label: tl('No template', 'Aucun modèle'), value: NONE }, ...(data.value?.templates ?? []).map(tp => ({ label: tp.id, value: tp.id }))])
const visibilityItems = (v?: RepoVisibility) => [
  ...((v?.value ?? 'unknown') === 'unknown' ? [{ label: tl('Repository: unknown', 'Dépôt : inconnu'), value: 'unknown', disabled: true }] : []),
  { label: tl('Public repository', 'Dépôt public'), value: 'public' },
  { label: tl('Private repository', 'Dépôt privé'), value: 'private' },
]
const formTemplate = computed({ get: () => orNone(form.template), set: (v: string) => { form.template = fromNone(v) } })
const remove = (key: string) => run(`rm:${key}`, async () => {
  await api('/api/pm/project-remove', { key })
  await load()
})
</script>

<template>
  <div class="settings-group pm-settings" data-testid="pm-settings">
    <label class="settings-toggle">
      <span>
        <b>{{ tl('Project management', 'Gestion de projet') }}</b>
        <small>{{ tl('Tasks follow the template of their project. Off, nothing is changed.', 'Les tâches suivent le modèle de leur projet. Coupée, rien n’est modifié.') }}</small>
      </span>
      <USwitch :model-value="data?.enabled ?? false" :disabled="!data || busy === 'switch'" color="success" size="xl" data-testid="pm-switch" @update:model-value="v => toggle(v)" />
    </label>
    <UButton to="/board?guide=1" color="neutral" variant="ghost" size="lg" icon="i-lucide-list-checks" class="pm-guide-link" data-testid="pm-guide-link">{{ tl('Getting started', 'Pour commencer') }}</UButton>

    <template v-if="data?.enabled">
      <h3>{{ tl('Projects', 'Projets') }}</h3>
      <div v-if="data.projects.length" class="settings-card">
        <div v-for="p in data.projects" :key="p.key" class="pm-row" data-testid="pm-project">
          <span class="pm-id"><b>{{ p.name }}<span v-if="p.visibility?.value === 'public'" class="pm-public" data-testid="pm-public">{{ tl('Public', 'Public') }}</span></b><small class="mono-label">{{ p.key }} · {{ machineName(p.machine) }}</small><small class="pm-path">{{ ltr(shortPath(p.path)) }}</small></span>
          <USelect
            :model-value="orNone(p.template)" :items="templateItems" size="lg" class="pm-row-template" :disabled="busy !== ''" :aria-label="tl(`Template of ${p.name}`, `Modèle de ${p.name}`)"
            data-testid="pm-project-template" @update:model-value="v => pickTemplate(p.key, fromNone(v))"
          />
          <UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-trash-2" :aria-label="tl(`Remove ${p.name}`, `Retirer ${p.name}`)" :loading="busy === `rm:${p.key}`" @click="remove(p.key)" />
          <span class="pm-vis">
            <USelect
              :model-value="p.visibility?.value ?? 'unknown'" :items="visibilityItems(p.visibility)" size="lg" :disabled="busy !== ''" :aria-label="tl(`Repository of ${p.name}`, `Dépôt de ${p.name}`)"
              data-testid="pm-visibility" @update:model-value="v => setVisibility(p.key, { value: String(v) })"
            />
            <small class="mono-label">{{ visibilityNote(p.visibility) }}</small>
            <UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-refresh-cw" :loading="busy === `vis:${p.key}`" :disabled="busy !== ''" data-testid="pm-visibility-check" @click="setVisibility(p.key, { check: true })">{{ tl('Check again', 'Revérifier') }}</UButton>
          </span>
        </div>
      </div>
      <UButton v-if="data.projects.length" to="/board" color="neutral" variant="outline" size="xl" icon="i-lucide-kanban" class="pm-board" data-testid="pm-board">{{ tl('Open the board', 'Ouvrir le tableau') }}</UButton>
      <p v-else class="muted settings-hint" data-testid="pm-empty">{{ tl('No project yet.', 'Aucun projet pour l’instant.') }}</p>

      <template v-if="data.projects.length">
        <h3>{{ tl('Automations', 'Automatisations') }}</h3>
        <p class="muted settings-hint">{{ tl('Each firing adds a task from the project\'s template and starts it at once.', 'Chaque déclenchement ajoute une tâche du modèle du projet et la lance aussitôt.') }}</p>
        <div class="settings-card">
          <ProjectAutomations v-for="p in data.projects" :key="p.key" :project="p.key" :name="p.name" />
        </div>
      </template>

      <h3>{{ tl('Templates', 'Modèles') }}</h3>
      <TemplateEditor :templates="data.templates" @saved="load" />

      <form class="sheet-form" @submit.prevent="add">
        <h3>{{ tl('Add a project', 'Ajouter un projet') }}</h3>
        <label class="field-label" for="pmKey">{{ tl('Key', 'Clé') }}</label>
        <UInput id="pmKey" v-model="form.key" size="xl" class="w-full mono" autocapitalize="characters" autocorrect="off" :spellcheck="false" placeholder="WEB" maxlength="10" />
        <label class="field-label" for="pmName">{{ t('Name') }} <span class="muted">{{ t('(optional)') }}</span></label>
        <UInput id="pmName" v-model="form.name" size="xl" class="w-full" maxlength="80" />
        <template v-if="machineList.length">
          <span class="field-label">{{ t('Machine') }}</span>
          <MachineChoice :machines="machineList" :model-value="form.machine" @pick="m => (form.machine = m.key)" />
        </template>
        <label class="field-label" for="pmPath">{{ tl('Git folder', 'Dossier git') }}</label>
        <UInput id="pmPath" v-model="form.path" size="xl" class="w-full mono" autocapitalize="none" autocorrect="off" :spellcheck="false" placeholder="~/src/web" maxlength="1024" />
        <label class="field-label" for="pmBase">{{ tl('Base branch', 'Branche de base') }} <span class="muted">{{ t('(optional)') }}</span></label>
        <UInput id="pmBase" v-model="form.base" size="xl" class="w-full mono" autocapitalize="none" autocorrect="off" :spellcheck="false" placeholder="main" maxlength="100" />
        <label class="field-label" for="pmTemplate">{{ tl('Template', 'Modèle') }}</label>
        <USelect id="pmTemplate" v-model="formTemplate" :items="templateItems" size="lg" class="w-full" data-testid="pm-template" />
        <p v-if="!data.templates.length" class="muted settings-hint">{{ tl('No template saved yet: tasks cannot start until the project has one.', 'Aucun modèle enregistré : les tâches ne pourront pas démarrer tant que le projet n’en a pas.') }}</p>
        <UButton type="submit" size="xl" color="primary" variant="solid" class="hw-cta" icon="i-lucide-plus" :loading="busy === 'add'" :disabled="!canAdd">{{ tl('Add project', 'Ajouter le projet') }}</UButton>
      </form>
    </template>
    <p v-if="error" class="form-error" role="alert">{{ t(error) }}</p>
  </div>
</template>

<style scoped>
.pm-settings h3 { margin-top: 24px; }
.pm-board, .pm-guide-link { margin-top: 8px; }
.pm-settings .settings-card { padding: 0; }
.pm-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 12px; padding: 13px 16px; border-bottom: 1px solid var(--line); }
.pm-row:last-child { border-bottom: 0; }
.pm-id { display: grid; gap: 2px; min-width: 0; overflow-wrap: anywhere; }
.pm-public { margin-left: 8px; padding: 2px 6px; border: 1px solid var(--blocked); color: var(--blocked); font: 600 11px/1 var(--font-mono, 'JetBrains Mono', monospace); letter-spacing: .08em; text-transform: uppercase; vertical-align: 2px; }
.pm-vis { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
.pm-path { color: var(--muted); font-family: var(--font-mono, 'JetBrains Mono', monospace); font-size: 12px; }
.pm-settings form.sheet-form { margin-top: 8px; }
.pm-settings form .settings-hint { margin-bottom: 16px; }
@media (max-width: 520px) {
  .pm-row { grid-template-columns: minmax(0, 1fr) auto; }
  .pm-row > :deep(.pm-row-template) { grid-column: 1 / -1; grid-row: 2; width: 100%; }
}
</style>
