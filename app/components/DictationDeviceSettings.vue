<script setup lang="ts">
// Settings › Conversation › Dictation › On this device: the models of the
// catalog (utils/dictation/models.json) that can run here, each with its
// languages, size, quality and speed, and Install / Cancel / Delete. The
// chosen model is kept per device. Row layout after followcat's model list
// (followcat/wherdr, branch mobile, MIT).
import { fmtBytes } from '~/utils/bytes'
import { DEVICE_MODELS, DEVICE_MODEL_KEY, deviceModel, gpuFeatures, modelBytes, qualityRating, runnableModels } from '~/utils/dictation/deviceModels'
import type { DeviceModel, DeviceNeed } from '~/utils/dictation/deviceModels'
import { cancelInstall, deleteModel, fetchCommand, installModel, MissingOnServer, storageInfo, storedBytes, watchInstall } from '~/utils/dictation/modelStore'
import type { Progress, StorageInfo } from '~/utils/dictation/modelStore'
import { disposeEngines } from '~/utils/dictation/registry'

const gpu = ref<DeviceNeed[]>([])
const models = computed(() => runnableModels(gpu.value))
const chosen = ref(deviceModel(readSaved()).id)
const have = reactive<Record<string, number>>({})
const progress = reactive<Record<string, Progress | null>>({})
const errors = reactive<Record<string, string>>({})
// Models whose files the server does not have (404 from /models/).
const missing = reactive<Record<string, boolean>>({})
const storage = ref<StorageInfo>({ free: null, persisted: null })
const canKeep = typeof caches !== 'undefined'

function readSaved() {
  try { return localStorage.getItem(DEVICE_MODEL_KEY) }
  catch { return null }
}

function choose(id: string) {
  if (id === chosen.value) return
  chosen.value = id
  try { localStorage.setItem(DEVICE_MODEL_KEY, id) }
  catch { /* private mode: this page only */ }
  disposeEngines() // the next press loads the new model
}

async function refresh(m: DeviceModel) {
  have[m.id] = await storedBytes(m).catch(() => 0)
}

async function follow(m: DeviceModel, run: Promise<void>) {
  errors[m.id] = ''
  missing[m.id] = false
  try { await run }
  catch (e) {
    if (e instanceof MissingOnServer) missing[m.id] = true
    else if ((e as Error).name !== 'AbortError') errors[m.id] = (e as Error).message
  }
  finally {
    progress[m.id] = null
    await refresh(m)
    storage.value = await storageInfo()
  }
}

function install(m: DeviceModel) {
  progress[m.id] = { got: have[m.id] ?? 0, total: modelBytes(m) }
  follow(m, installModel(m, (p) => { progress[m.id] = p; have[m.id] = p.got }))
}

async function remove(m: DeviceModel) {
  await deleteModel(m).catch(e => toast((e as Error).message, true))
  if (m.id === chosen.value) disposeEngines()
  await refresh(m)
  storage.value = await storageInfo()
}

onMounted(async () => {
  gpu.value = await gpuFeatures()
  await Promise.all(DEVICE_MODELS.map(refresh))
  // A download started by the mic (or before this page was opened) shows here too.
  for (const m of DEVICE_MODELS) {
    const run = watchInstall(m.id, (p) => { progress[m.id] = p; have[m.id] = p.got })
    if (run) follow(m, run)
  }
  storage.value = await storageInfo()
})

const used = computed(() => Object.values(have).reduce((n, b) => n + b, 0))
const pct = (p: Progress) => Math.floor((p.got / Math.max(1, p.total)) * 100)

// FR and EN first (the interface's languages), then how many more.
function langs(m: DeviceModel) {
  const head = ['fr', 'en'].filter(l => m.languages.includes(l))
  const shown = head.length ? head : m.languages.slice(0, 2)
  const more = m.languages.length - shown.length
  return [...shown.map(l => l.toUpperCase()), ...(more ? [`+${more}`] : [])].join(' · ')
}

const dots = (n: number) => '■'.repeat(n) + '□'.repeat(5 - n)
function quality(m: DeviceModel, lang: string) {
  const q = qualityRating(m, lang)
  if (q === 'unsupported') return { text: '—', title: tl('Not supported', 'Non prise en charge') }
  if (!q) return { text: tl('unknown', 'inconnue'), title: tl('No published figure', 'Aucun chiffre publié') }
  return { text: dots(q.dots), title: tl(`${q.wer} % word errors on ${q.dataset} (${q.source})`, `${q.wer} % de mots faux sur ${q.dataset} (${q.source})`) }
}
</script>

<template>
  <div class="dictation-device" data-testid="dictation-device">
    <div class="dictation-models" role="radiogroup" :aria-label="tl('Model', 'Modèle')">
      <div v-for="m in models" :key="m.id" class="dictation-model" :class="{ on: chosen === m.id }" :data-model="m.id">
        <button type="button" role="radio" :aria-checked="chosen === m.id" class="dictation-model-pick" @click="choose(m.id)">
          <UIcon :name="chosen === m.id ? 'i-lucide-square-dot' : 'i-lucide-square'" class="dictation-model-dot" />
          <span class="dictation-model-text">
            <b>{{ m.name }}</b>
            <small class="dictation-model-meta" :title="m.languages.join(', ')">{{ langs(m) }} · {{ fmtBytes(modelBytes(m)) }}</small>
            <small class="dictation-model-rating">
              <span>{{ tl('Quality', 'Qualité') }}</span>
              <template v-for="l in ['fr', 'en']" :key="l">
                <i :title="quality(m, l).title">{{ l.toUpperCase() }} <em>{{ quality(m, l).text }}</em></i>
              </template>
            </small>
            <small class="dictation-model-rating">
              <span>{{ tl('Speed', 'Vitesse') }}</span>
              <i v-if="m.speed" :title="`${m.speed.basis} (${m.speed.source})`"><em>{{ dots(m.speed.estimate) }}</em> {{ tl('est.', 'estimée') }}</i>
              <i v-else><em>{{ tl('unknown', 'inconnue') }}</em></i>
            </small>
          </span>
        </button>
        <div class="dictation-model-state" data-testid="model-state">
          <template v-if="progress[m.id]">
            <progress :value="progress[m.id]!.got" :max="progress[m.id]!.total" />
            <small>{{ pct(progress[m.id]!) }} % · {{ fmtBytes(progress[m.id]!.got) }} / {{ fmtBytes(progress[m.id]!.total) }}</small>
            <UButton color="neutral" variant="outline" size="md" :label="t('Cancel')" @click="cancelInstall(m.id)" />
          </template>
          <template v-else-if="have[m.id] && have[m.id]! >= modelBytes(m)">
            <small><UIcon name="i-lucide-check" /> {{ tl('Installed', 'Installé') }}</small>
            <UButton color="neutral" variant="outline" size="md" icon="i-lucide-trash-2" :label="tl('Delete', 'Supprimer')" @click="remove(m)" />
          </template>
          <template v-else>
            <small v-if="have[m.id]">{{ tl('Partly downloaded', 'Téléchargé en partie') }} · {{ fmtBytes(have[m.id]!) }}</small>
            <UButton color="primary" variant="outline" size="md" icon="i-lucide-download" :disabled="!canKeep" :label="have[m.id] ? tl('Resume', 'Reprendre') : tl(`Install · ${fmtBytes(modelBytes(m))}`, `Installer · ${fmtBytes(modelBytes(m))}`)" @click="install(m)" />
            <UButton v-if="have[m.id]" color="neutral" variant="ghost" size="md" :label="tl('Delete', 'Supprimer')" @click="remove(m)" />
          </template>
          <small v-if="missing[m.id]" class="dictation-model-error" role="status" data-testid="model-missing">
            {{ tl('The wherdr server does not have this model’s files. On the server, in the wherdr folder, with its DATA_DIR, run:', 'Le serveur wherdr n’a pas les fichiers de ce modèle. Sur le serveur, dans le dossier de wherdr, avec son DATA_DIR, lancez :') }}
            <code>{{ fetchCommand(m) }}</code>
            {{ tl('See docs/installation.md, “On-device dictation files”.', 'Voir docs/installation.md, « On-device dictation files ».') }}
          </small>
          <small v-else-if="errors[m.id]" class="dictation-model-error" role="status">{{ errors[m.id] }}</small>
        </div>
      </div>
    </div>
    <p class="muted settings-hint" data-testid="dictation-storage">
      <template v-if="!canKeep">{{ tl('This browser cannot keep models (it needs an HTTPS address): the model is downloaded from the wherdr server at each first use.', 'Ce navigateur ne peut pas garder les modèles (il faut une adresse HTTPS) : le modèle est téléchargé depuis le serveur wherdr à chaque première utilisation.') }}</template>
      <template v-else>
        {{ tl(`${fmtBytes(used)} used on this device`, `${fmtBytes(used)} utilisés sur cet appareil`) }}<template v-if="storage.free != null"> · {{ tl(`${fmtBytes(storage.free)} free`, `${fmtBytes(storage.free)} libres`) }}</template>.
        {{ storage.persisted ? tl('The browser keeps these files.', 'Le navigateur garde ces fichiers.') : tl('The browser may clear these files when space runs low; the app added to the home screen keeps them better.', 'Le navigateur peut effacer ces fichiers si la place manque ; l’app ajoutée à l’écran d’accueil les garde mieux.') }}
      </template>
    </p>
  </div>
</template>

<style scoped>
.dictation-device { margin-top: 12px; }
.dictation-model { background: var(--bg-2); border: 1px solid var(--line); }
.dictation-model + .dictation-model { border-top: 0; }
.dictation-model.on { box-shadow: inset 2px 0 0 var(--accent); }
.dictation-model-pick { display: flex; gap: 12px; width: 100%; padding: 13px 16px 8px; text-align: left; min-height: 44px; }
.dictation-model-dot { flex: none; width: 18px; height: 18px; margin-top: 2px; color: var(--muted); }
.on .dictation-model-dot { color: var(--accent); }
.dictation-model-text { min-width: 0; }
.dictation-model-text b { display: block; font-weight: 600; font-size: 15px; }
.dictation-model-text small { display: block; font-size: 12.5px; color: var(--muted); margin-top: 3px; }
.dictation-model-rating { display: flex !important; flex-wrap: wrap; gap: 4px 10px; font: 500 11px/1.5 var(--mono); letter-spacing: .06em; text-transform: uppercase; }
.dictation-model-rating span { color: var(--dim); }
.dictation-model-rating i { font-style: normal; color: var(--text-2); }
.dictation-model-rating em { font-style: normal; color: var(--accent); letter-spacing: .02em; }
.dictation-model-state { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 0 16px 13px 46px; }
.dictation-model-state small { font: 500 11px/1.4 var(--mono); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); display: inline-flex; align-items: center; gap: 4px; }
.dictation-model-state progress { flex: 1 1 100%; height: 4px; appearance: none; border: 0; background: var(--line); accent-color: var(--accent); }
.dictation-model-state progress::-webkit-progress-bar { background: var(--line); }
.dictation-model-state progress::-webkit-progress-value { background: var(--accent); }
.dictation-model-state progress::-moz-progress-bar { background: var(--accent); }
.dictation-model-error { display: block !important; flex-basis: 100%; color: var(--rose) !important; text-transform: none !important; }
.dictation-model-error code { display: block; margin: 4px 0; font: 500 11.5px/1.4 var(--mono); color: var(--text); overflow-wrap: anywhere; user-select: all; -webkit-user-select: all; }
.dictation-device .settings-hint { margin-top: 10px; }
</style>
