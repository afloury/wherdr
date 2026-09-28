<script setup lang="ts">
// Liste des agents, groupés par état ; barre latérale sur ordinateur.
// Plusieurs machines : une section par machine (comme la barre latérale de
// Herdr), repliable, avec son état de connexion ; les groupes d'état à
// l'intérieur. Une seule machine : la liste d'avant, sans en-tête.
// Projets herdr-projects (coordinateur + threads) : un bloc repliable par projet,
// avant les groupes d'état des autres agents ; sous chaque machine.
// Quotas : ceux communs à toutes les machines en haut ; le compte Claude propre
// à une machine (comptes différents) et son bandeau d'installation sous son en-tête.
// Une ligne par space Herdr (shared/spaces.ts) : un space d'un seul onglet et
// d'un seul pane garde la carte de son agent ; sinon une carte de space, rangée
// d'après son pane le plus urgent. Les threads d'un projet restent sous leur
// machine ; coordonnés depuis une autre, leur bloc le dit et y mène.
// Terminaux : un space de shell est une ligne comme une autre, rangée dans
// Prêts (réglage « Afficher les terminaux ») ; le terminal racine du dépôt d'un
// projet devient un petit en-tête au-dessus de ses threads.
import type { MachineInfo, NamedSession, Pane } from '#shared/types'
import { groupByProject, remoteCoordinator } from '#shared/projects'
import { type Row, projectRoots, readyLists, repoRoots, rowGroup, spaceRows } from '#shared/spaces'
import { claudeSetupOf, machineQuotaRows, quotaRows } from '~/utils/quotas'
import { moveMachine, sortMachines } from '#shared/machineOrder'
import type { AwakeState, SleepAssertion, AwakeMode } from '../../server/utils/awake'
const emit = defineEmits<{ search: [] }>()
useQuotaLoader()

const everOpen = ref(false)
watch(eventsOpen, (v) => { if (v) everOpen.value = true })

const st = herdrState
const agents = computed(() => st.value.panes.filter(p => p.agent))
// Compteurs globaux (toutes machines), hors machines injoignables.
const count = (s: string) => agents.value.filter(p => p.status === s && !paneStale(p)).length

const conn = computed(() => {
  if (offlineView.value) return { ok: false, text: t('hors ligne'), idle: false }
  if (!eventsOpen.value) return { ok: false, text: everOpen.value ? t('hors ligne — reconnexion…') : t('connexion…'), idle: !everOpen.value }
  if (!st.value.ok) return { ok: false, text: t('Herdr injoignable'), idle: false }
  return { ok: true, text: `wherdr · herdr ${st.value.version || ''}`.trim(), idle: false }
})

// Compteurs façon « tableau de bord » : toujours les trois, les zéros en retrait.
const stats = computed(() => ([
  ['blocked', count('blocked'), t('à toi')],
  ['working', count('working'), t('au travail')],
  ['done', count('done') + count('idle'), t('prêts')],
] as [string, number, string][]).map(([s, n, label]) => ({ s, n, label })))

// L'ordre Herdr reste celui de chaque liste de dépôt. Le groupe Prêts peut
// afficher les non lus avant les lus, chacun réordonnable séparément.
function groupsOf(list: Row[]) {
  return ([
    { key: 'blocked', title: t('À toi'), list: list.filter(r => rowGroup(r) === 'blocked') },
    { key: 'working', title: t('Au travail'), list: list.filter(r => rowGroup(r) === 'working') },
    { key: 'ready', title: t('Prêts'), list: list.filter(r => rowGroup(r) === 'ready') },
  ] as const).filter(g => g.list.length).map(g => ({ ...g, lists: g.key === 'ready' ? readyLists(g.list, autoReorderReady.value) : [g.list] }))
}
// Lignes d'une machine (`machine` absent : une seule machine) : projets
// (leurs lignes retrouvées par pane représentatif, le terminal racine de leur
// dépôt), puis les groupes d'état des autres spaces, shells compris, dans
// l'ordre de Herdr.
function listOf(rows: Row[], machine?: string) {
  const agentRows = rows.filter(r => r.lead.agent)
  const byLead = new Map(agentRows.map(r => [r.lead.id, r]))
  const byProject = groupByProject(agentRows.map(r => r.lead))
  const roots = repoRoots(st.value, rows)
  const projects = byProject.projects.map(g => ({
    g,
    remote: machine === undefined ? null : remoteCoordinator(g, agents.value, machine),
    roots: projectRoots(roots, g.panes),
  }))
  const inHeader = new Set(projects.flatMap(x => x.roots.map(r => r.row.key)))
  const others = new Set(byProject.others.map(p => p.id))
  return {
    rowOf: (p: Pane) => byLead.get(p.id),
    projects,
    groups: groupsOf(rows.filter(r => (r.lead.agent ? others.has(r.lead.id) : showShells.value && !inHeader.has(r.key)))),
  }
}
const solo = computed(() => listOf(spaceRows(st.value)))

const topQuotas = computed(() => (showQuotas.value ? quotaRows(homeQuotas.value, hiddenAgents.value) : []))
const hasClaude = (list: Pane[]) => list.some(p => p.agent === 'claude')
const localSetup = computed(() => (showQuotas.value ? claudeSetupOf(homeQuotas.value, '', hasClaude(agents.value), hiddenAgents.value) : null))

// ------------------------------------------------------------ machines
const STATE_LABEL: Record<MachineInfo['status'], string> = { online: 'en ligne', connecting: 'reconnexion…', offline: 'hors ligne' }
const machineOrder = ref<string[]>([])
const orderedMachines = computed(() => sortMachines(machines.value, machineOrder.value))
const visibleKeys = computed(() => [...new Set(orderedMachines.value.map(m => m.baseKey ?? m.key))])
const draggingMachine = ref<string | null>(null)
const dropMachine = ref<string | null>(null)
const dropAfter = ref(false)
async function loadMachineOrder() {
  try { machineOrder.value = (await api<{ order: string[] }>('/api/machine/order')).order }
  catch { /* L'ordre de Herdr reste disponible hors ligne. */ }
}
onMounted(loadMachineOrder)
async function saveMachineOrder(order: string[]) {
  const previous = machineOrder.value
  machineOrder.value = order
  try { machineOrder.value = (await api<{ order: string[] }>('/api/machine/order', { order })).order }
  catch (err) { machineOrder.value = previous; toast((err as Error).message, true) }
}
function shiftMachine(key: string, direction: -1 | 1) {
  const keys = visibleKeys.value
  const at = keys.indexOf(key)
  const other = at + direction
  if (at < 0 || other < 0 || other >= keys.length) return
  const next = [...keys]
  ;[next[at], next[other]] = [next[other]!, next[at]!]
  haptic()
  saveMachineOrder(next)
}
function onMachineDrop(key: string, event: DragEvent) {
  event.preventDefault()
  const from = draggingMachine.value
  const keys = visibleKeys.value
  const before = dropAfter.value ? keys[keys.indexOf(key) + 1] ?? null : key
  draggingMachine.value = null
  dropMachine.value = null
  if (!from || from === key) return
  saveMachineOrder(moveMachine(keys, from, before))
}
function onMachineDragOver(key: string, event: DragEvent) {
  if (!draggingMachine.value || draggingMachine.value === key) return
  event.preventDefault()
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  dropMachine.value = key
  dropAfter.value = event.clientY > rect.top + rect.height / 2
}
function onMachineDragStart(key: string, event: DragEvent) {
  draggingMachine.value = key
  event.dataTransfer?.setData('text/plain', key)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}
function onMachineDragEnd() { draggingMachine.value = null; dropMachine.value = null }
const sections = computed(() => {
  if (!multiMachine.value) return null
  return orderedMachines.value.map((m) => {
    const mine = (p: Pane) => (p.machine || '') === m.key
    const a = agents.value.filter(mine)
    return {
      m,
      name: machineName(m.key),
      state: t(STATE_LABEL[m.status]),
      agents: a,
      ...listOf(spaceRows(st.value, m.key), m.key),
      waiting: a.filter(p => p.status === 'blocked').length,
      collapsed: collapsedMachines.value.includes(m.key),
      quotas: showQuotas.value && m.status === 'online' ? machineQuotaRows(homeQuotas.value, m.baseKey ?? m.key, hiddenAgents.value) : [],
      setup: showQuotas.value && m.status === 'online' ? claudeSetupOf(homeQuotas.value, m.baseKey ?? m.key, hasClaude(a), hiddenAgents.value) : null,
    }
  })
})
function toggleMachine(key: string) {
  haptic()
  const c = collapsedMachines.value
  collapsedMachines.value = c.includes(key) ? c.filter(k => k !== key) : [...c, key]
}
const renamingMachine = ref<MachineInfo | null>(null)
const machineLabel = ref('')
const awakeByMachine = ref<Record<string, AwakeState>>({})
const awakeTarget = ref<MachineInfo | null>(null)
const awakeBusy = ref(false)
const awakeLid = ref(false)
const diagnosticTarget = ref<MachineInfo | null>(null)
const assertions = ref<SleepAssertion[]>([])
const diagnosticBusy = ref(false)
const awakeOpen = computed({ get: () => Boolean(awakeTarget.value), set: v => { if (!v) awakeTarget.value = null } })
const diagnosticOpen = computed({ get: () => Boolean(diagnosticTarget.value), set: v => { if (!v) diagnosticTarget.value = null } })
const awakeUrl = (key: string, diagnostic = false) => `/api/machine/awake?key=${encodeURIComponent(key)}${diagnostic ? '&diagnostic=1' : ''}`
async function refreshAwake(m: MachineInfo) {
  if (m.status !== 'online') return
  try { awakeByMachine.value[m.key] = await api<AwakeState>(awakeUrl(m.key)) }
  catch { /* machine peut disparaître entre deux sondages */ }
}
watch(() => machines.value.map(m => `${m.key}:${m.status}`).join('|'), () => {
  for (const m of machines.value) refreshAwake(m)
}, { immediate: true })
let awakeTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => { awakeTimer = setInterval(() => { if (document.visibilityState === 'visible') for (const m of machines.value) refreshAwake(m) }, 30000) })
onBeforeUnmount(() => clearInterval(awakeTimer))
function openAwake(m: MachineInfo) {
  awakeTarget.value = m
  awakeLid.value = awakeByMachine.value[m.key]?.lid || false
  refreshAwake(m)
}
async function chooseAwake(mode: AwakeMode | 'off') {
  const m = awakeTarget.value
  if (!m || awakeBusy.value) return
  awakeBusy.value = true
  try {
    awakeByMachine.value[m.key] = await api<AwakeState>('/api/machine/awake', { key: m.key, mode, lid: mode === 'off' ? false : awakeLid.value })
    awakeTarget.value = null
  } catch (e) { toast((e as Error).message, true) }
  finally { awakeBusy.value = false }
}
async function openDiagnostic(m: MachineInfo) {
  diagnosticTarget.value = m
  diagnosticBusy.value = true
  assertions.value = []
  try {
    const result = await api<AwakeState & { assertions: SleepAssertion[] }>(awakeUrl(m.key, true))
    awakeByMachine.value[m.key] = result
    assertions.value = result.assertions
  } catch (e) { toast((e as Error).message, true) }
  finally { diagnosticBusy.value = false }
}
function durationLabel(seconds: number) {
  if (seconds < 60) return tl('moins d’une minute', 'less than a minute')
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`
  return `${Math.floor(seconds / 3600)} h ${Math.floor(seconds % 3600 / 60)} min`
}
function awakeLabel(state?: AwakeState) {
  if (!state?.active) return ''
  return state.until ? tl(`Éveillé jusqu’à ${new Date(state.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, `Awake until ${new Date(state.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`) : tl('Éveillé jusqu’à désactivation', 'Awake until turned off')
}
const savingMachine = ref(false)
const sessionTarget = ref<MachineInfo | null>(null)
const sessionRows = ref<NamedSession[]>([])
const sessionsLoading = ref(false)
const sessionOpen = computed({ get: () => Boolean(sessionTarget.value), set: (v: boolean) => { if (!v) sessionTarget.value = null } })
const soloMachine = computed<MachineInfo>(() => machines.value[0] || {
  key: '', label: hostLabel.value || 'herdr', local: true, status: st.value.ok ? 'online' : 'offline',
  error: null, session: st.value.session || 'default',
})
const baseKeyOf = (m: MachineInfo) => m.baseKey ?? m.key
async function openSessions(m: MachineInfo) {
  sessionTarget.value = m
  sessionsLoading.value = true
  sessionRows.value = []
  try { sessionRows.value = await listMachineSessions(baseKeyOf(m)) }
  catch (err) { toast((err as Error).message, true) }
  finally { sessionsLoading.value = false }
}
async function selectSession(s: NamedSession) {
  const m = sessionTarget.value
  if (!m || !s.running) return
  sessionsLoading.value = true
  try {
    await chooseMachineSession(baseKeyOf(m), s.name)
    sessionTarget.value = null
    await navigateTo('/')
  } catch (err) { toast((err as Error).message, true) }
  finally { sessionsLoading.value = false }
}
const renameMachineOpen = computed({
  get: () => Boolean(renamingMachine.value),
  set: (open: boolean) => { if (!open) renamingMachine.value = null },
})
function machineMenu(m: MachineInfo) {
  const items: MenuItem[] = [{ label: t('Sessions Herdr'), icon: 'i-lucide-layers', run: () => openSessions(m) }, { label: t('Renommer'), icon: 'i-lucide-pencil', run: () => {
    renamingMachine.value = m
    machineLabel.value = m.label
  } }]
  if (multiMachine.value) {
    const key = baseKeyOf(m)
    const at = visibleKeys.value.indexOf(key)
    if (at > 0) items.push({ label: t('Monter'), icon: 'i-lucide-arrow-up', run: () => shiftMachine(key, -1) })
    if (at >= 0 && at < visibleKeys.value.length - 1) items.push({ label: t('Descendre'), icon: 'i-lucide-arrow-down', run: () => shiftMachine(key, 1) })
    if (machineOrder.value.length) items.push({ label: t('Réinitialiser l’ordre'), icon: 'i-lucide-rotate-ccw', run: () => saveMachineOrder([]) })
  }
  if (m.status === 'online' && awakeByMachine.value[m.key]?.supported) {
    items.push({ label: t('Garder éveillé'), icon: 'i-lucide-sun', run: () => openAwake(m) })
    if (awakeByMachine.value[m.key]?.platform === 'mac') items.push({ label: t('Ce qui empêche la veille'), icon: 'i-lucide-list-filter', run: () => openDiagnostic(m) })
  }
  // Actions globales des plugins Herdr de cette machine.
  if (m.status === 'online' && machinePluginActions(m.key).length) {
    items.push({ label: t('Actions des plugins'), icon: 'i-lucide-puzzle', run: () => openPluginMenu({ machine: m.key }) })
  }
  return toDropdown(items)
}
// Actions des plugins de chaque machine en ligne (une seule : la locale).
const onlineKeys = computed(() => JSON.stringify(multiMachine.value ? machines.value.filter(m => m.status === 'online').map(m => m.key) : (st.value.ok ? [''] : [])))
watch(onlineKeys, (keys) => { for (const k of JSON.parse(keys) as string[]) loadPluginActions(k) }, { immediate: true })
// Mode silence actif : cloche barrée à côté des réglages ; l'appui le coupe.
const quietLabel = computed(() => tl('Silence actif — toucher pour réactiver les notifications', 'Do not disturb is on — tap to turn notifications back on'))
const onQuietVisible = () => { if (document.visibilityState === 'visible') refreshQuiet() }
onMounted(() => { refreshQuiet(); document.addEventListener('visibilitychange', onQuietVisible) })
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onQuietVisible))
const soloPlugins = computed(() => !multiMachine.value && machinePluginActions('').length > 0)
function openSoloPlugins() {
  haptic()
  openPluginMenu({ machine: '' })
}
async function saveMachine() {
  if (!renamingMachine.value || savingMachine.value) return
  const label = machineLabel.value.replace(/\s+/g, ' ').trim()
  if (!label) return
  savingMachine.value = true
  try {
    await api('/api/machine/rename', { key: baseKeyOf(renamingMachine.value), label })
    renamingMachine.value = null
    await loadConfig()
    toast(t('Machine renommée'))
  } catch (err) { toast((err as Error).message, true) }
  finally { savingMachine.value = false }
}

// Réordonner : connecté, et la machine en ligne.
function canReorder(machine: string) {
  if (offlineView.value || !eventsOpen.value || !st.value.ok) return false
  return !multiMachine.value || machines.value.some(m => m.key === machine && m.status === 'online')
}

function newAgent() {
  haptic()
  newAgentOpen.value = true
}
function openSearch() { emit('search') }
</script>

<template>
  <section id="home" class="view">
    <header class="home-top">
      <div class="home-brand">
        <p class="eyebrow">
          <AppLogo class="home-logo" :class="conn.idle ? '' : conn.ok ? 'ok' : 'bad'" /><span>{{ conn.text }}</span>
        </p>
        <h1 class="display">{{ t('Agents') }}</h1>
      </div>
      <div class="home-actions">
        <UTooltip v-if="soloPlugins" :text="t('Actions des plugins')" :disabled="!desk">
          <UButton icon="i-lucide-puzzle" color="neutral" variant="ghost" size="lg" class="icon-btn" :aria-label="t('Actions des plugins')" @click="openSoloPlugins" />
        </UTooltip>
        <UTooltip :text="tl('Rechercher agents et conversations', 'Search agents and conversations')" :disabled="!desk">
          <UButton icon="i-lucide-search" color="neutral" variant="ghost" size="lg" class="icon-btn" :aria-label="tl('Rechercher agents et conversations', 'Search agents and conversations')" @click="openSearch" />
        </UTooltip>
        <UTooltip v-if="quietCurrent" :text="quietLabel" :disabled="!desk">
          <UButton icon="i-lucide-bell-off" color="neutral" variant="ghost" size="lg" class="icon-btn quiet-on" :aria-label="quietLabel" @click="endQuiet" />
        </UTooltip>
        <UTooltip :text="t('Réglages')" :disabled="!desk">
          <UButton
            icon="i-lucide-settings-2" color="neutral" variant="ghost" size="lg" class="icon-btn"
            :aria-label="t('Réglages')" to="/settings"
          />
        </UTooltip>
      </div>
    </header>

    <div class="scroll">
      <OfflineNote v-if="(offlineView && cachedAt) || netDown" class="home-offline" :label="offlineView && cachedAt ? t('Dernier état connu') : undefined" :at="cachedAt" date-style="medium" />
      <div v-if="eventsOpen && !st.ok" class="notice">
        {{ t('Le serveur Herdr ne répond pas') }}{{ st.error ? ` : ${st.error}` : '' }}.<br>
        {{ hostLabel ? tl(`Lance herdr sur ${hostLabel} pour le démarrer.`, `Run herdr on ${hostLabel} to start it.`) : tl('Lance herdr sur le serveur pour le démarrer.', 'Run herdr on the server to start it.') }}
      </div>
      <div v-if="!multiMachine" class="solo-machine-row"><button type="button" class="solo-session-row" :aria-label="t('Sessions Herdr')" @click="openSessions(soloMachine)">
        <span><UIcon name="i-lucide-layers" />{{ soloMachine.label }}</span>
        <b>{{ soloMachine.session || 'default' }}<UIcon name="i-lucide-chevron-right" /></b>
      </button><UDropdownMenu v-if="awakeByMachine[soloMachine.key]?.supported" :items="machineMenu(soloMachine)" :content="{ align: 'end' }" :ui="{ content: 'hw-dropdown' }"><UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" :aria-label="t('Options')" /></UDropdownMenu></div>
      <p v-if="!multiMachine && awakeByMachine[soloMachine.key]?.active" class="machine-awake"><UIcon name="i-lucide-sun" />{{ awakeLabel(awakeByMachine[soloMachine.key]) }}</p>

      <div v-if="showCounters && agents.length" class="stats">
        <div v-for="c in stats" :key="c.s" class="stat" :class="[c.s, { zero: !c.n }]">
          <b>{{ c.n }}</b>
          <span><i />{{ c.label }}</span>
        </div>
      </div>
      <QuotaStrip :rows="topQuotas" :class="{ 'after-stats': showCounters && agents.length }" />

      <ClaudeSetupBanner v-if="!sections && localSetup" :setup="localSetup" :name="machineName('') || t('cette machine')" class="solo" />

      <!-- Une seule machine : la liste d'avant. -->
      <template v-if="!sections">
        <ProjectGroup v-for="x in solo.projects" :key="x.g.key" :group="x.g" :row-of="solo.rowOf" :roots="x.roots" />
        <section v-for="g in solo.groups" :key="g.key" class="agent-group" :class="g.key">
          <h2 class="group-title"><span>{{ g.title }}</span><span class="count">{{ g.list.length }}</span></h2>
          <template v-for="(cards, i) in g.lists" :key="i">
            <p v-if="g.key === 'ready' && g.lists.length > 1" class="ready-subgroup-label">{{ t(i === 0 ? 'Non lus' : 'Lus') }}</p>
            <ReorderList :disabled="!canReorder('')">
              <AgentCard v-for="r in cards" :key="r.key" :pane="r.lead" :row="r" />
            </ReorderList>
          </template>
        </section>

        <div v-if="st.ok && !agents.length" class="empty hw-grid">
          <div class="empty-box">
            <div class="empty-art">&gt;_</div>
            <p>{{ t('Aucun agent pour l’instant.') }}</p>
            <p class="muted">{{ t('Lance-en un ici, ou depuis') }} <code>herdr</code> {{ t('dans un terminal.') }}</p>
          </div>
        </div>
      </template>

      <!-- Plusieurs machines : une section par machine. -->
      <template v-else>
        <section
          v-for="s in sections" :key="s.m.key" class="machine" :class="[s.m.status, { collapsed: s.collapsed, 'machine-drop-before': dropMachine === baseKeyOf(s.m) && !dropAfter, 'machine-drop-after': dropMachine === baseKeyOf(s.m) && dropAfter }]"
          :data-machine="s.m.key || 'local'"
          @dragover="onMachineDragOver(baseKeyOf(s.m), $event)"
          @dragleave="(e: DragEvent) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) dropMachine = null }"
          @drop="onMachineDrop(baseKeyOf(s.m), $event)"
        >
          <div class="machine-row">
            <button v-if="desk" type="button" class="machine-grip" draggable="true"
              :aria-label="tl(`Déplacer ${s.name} — flèches haut et bas`, `Move ${s.name} — up and down arrows`)"
              :title="t('Glisser pour réordonner')"
              @dragstart="onMachineDragStart(baseKeyOf(s.m), $event)" @dragend="onMachineDragEnd"
              @keydown.up.prevent="shiftMachine(baseKeyOf(s.m), -1)" @keydown.down.prevent="shiftMachine(baseKeyOf(s.m), 1)"
            ><UIcon name="i-lucide-grip-vertical" /></button>
            <button
              type="button" class="machine-head" :aria-expanded="!s.collapsed"
              :title="s.m.target ? `ssh ${s.m.target}` : undefined" @click="toggleMachine(s.m.key)"
            >
              <UIcon name="i-lucide-chevron-down" class="machine-chev" />
              <UIcon :name="s.m.local ? 'i-lucide-server' : 'i-lucide-laptop'" class="machine-icon" />
              <span class="machine-name">{{ s.name }}<small v-if="s.m.session && s.m.session !== 'default'" class="machine-session">{{ s.m.session }}</small></span>
              <span v-if="awakeByMachine[s.m.key]?.active" class="machine-awake" :title="awakeLabel(awakeByMachine[s.m.key])"><UIcon name="i-lucide-sun" /><span>{{ awakeByMachine[s.m.key]?.until ? new Date(awakeByMachine[s.m.key]!.until!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '∞' }}</span></span>
              <span class="machine-state"><i />{{ s.state }}</span>
              <span class="machine-count">
                <b v-if="s.waiting && s.collapsed" class="machine-waiting">{{ s.waiting }}</b>
                {{ s.agents.length }}
              </span>
            </button>
            <UDropdownMenu :items="machineMenu(s.m)" :content="{ align: 'end', sideOffset: 6 }" :ui="{ content: 'hw-dropdown' }" @update:open="(o: boolean) => { if (o && s.m.status === 'online') loadPluginActions(s.m.key) }">
              <UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" size="lg" class="machine-options icon-btn" :aria-label="`${t('Options')} : ${s.name}`" />
            </UDropdownMenu>
          </div>
          <p v-if="s.m.status !== 'online' && s.m.error" class="machine-error">{{ s.m.error }}</p>

          <div v-if="!s.collapsed" class="machine-body">
            <QuotaStrip :rows="s.quotas" class="machine-quotas" />
            <ClaudeSetupBanner v-if="s.setup" :setup="s.setup" :name="s.name" />
            <ProjectGroup v-for="x in s.projects" :key="x.g.key" :group="x.g" :machine="s.m.key" :row-of="s.rowOf" :remote="x.remote" :roots="x.roots" />
            <section v-for="g in s.groups" :key="g.key" class="agent-group" :class="g.key">
              <h2 class="group-title"><span>{{ g.title }}</span><span class="count">{{ g.list.length }}</span></h2>
              <template v-for="(cards, i) in g.lists" :key="i">
                <p v-if="g.key === 'ready' && g.lists.length > 1" class="ready-subgroup-label">{{ t(i === 0 ? 'Non lus' : 'Lus') }}</p>
                <ReorderList :disabled="!canReorder(s.m.key)">
                  <AgentCard v-for="r in cards" :key="r.key" :pane="r.lead" :row="r" />
                </ReorderList>
              </template>
            </section>

            <p v-if="!s.agents.length && !s.groups.length" class="machine-empty">
              {{ s.m.status === 'online' ? t('Aucun agent sur cette machine.') : t('Aucun agent connu.') }}
            </p>
          </div>
        </section>
      </template>
    </div>

    <div class="fab-wrap">
      <UButton class="fab hw-cta" icon="i-lucide-plus" color="primary" variant="solid" size="xl" :disabled="!eventsOpen || offlineView" @click="newAgent">
        {{ t('Nouveau') }}
      </UButton>
    </div>
    <AppSheet v-model:open="renameMachineOpen" :title="t('Renommer la machine')">
      <form class="rename" @submit.prevent="saveMachine">
        <UInput v-model="machineLabel" maxlength="40" size="xl" class="w-full" :placeholder="t('Nom de la machine')" autofocus />
        <div class="rename-actions">
          <UButton color="neutral" variant="ghost" class="sheet-btn" @click="renameMachineOpen = false">{{ t('Annuler') }}</UButton>
          <UButton type="submit" color="primary" variant="solid" class="sheet-btn hw-cta" :loading="savingMachine" :disabled="!machineLabel.trim()">{{ t('Enregistrer') }}</UButton>
        </div>
      </form>
    </AppSheet>
    <AppSheet v-model:open="sessionOpen" :title="t('Sessions Herdr')">
      <p class="session-intro">{{ t('Session affichée sur cet appareil') }} · {{ sessionTarget?.label }}</p>
      <p v-if="sessionsLoading" class="session-intro">{{ t('Chargement…') }}</p>
      <div v-else class="session-list">
        <button v-for="s in sessionRows" :key="s.name" type="button" class="session-choice" :disabled="!s.running"
          :aria-current="sessionTarget?.session === s.name ? 'true' : undefined" @click="selectSession(s)">
          <span><b>{{ s.name }}</b><small>{{ t(s.running ? 'en cours' : 'arrêtée') }}</small></span>
          <UIcon v-if="sessionTarget?.session === s.name" name="i-lucide-check" />
        </button>
        <p v-if="!sessionRows.length" class="session-intro">{{ t('Aucune session trouvée.') }}</p>
      </div>
    </AppSheet>
    <AppSheet v-model:open="awakeOpen" :title="t('Garder éveillé')">
      <p class="session-intro">{{ awakeTarget?.label }} · {{ awakeLabel(awakeTarget ? awakeByMachine[awakeTarget.key] : undefined) || t('Veille normale') }}</p>
      <p v-if="awakeTarget && awakeByMachine[awakeTarget.key]?.battery" class="session-intro"><UIcon name="i-lucide-battery" /> {{ awakeByMachine[awakeTarget.key]?.battery?.percent }} % · {{ awakeByMachine[awakeTarget.key]?.battery?.source === 'ac' ? t('Secteur') : t('Batterie') }}</p>
      <label v-if="awakeTarget && awakeByMachine[awakeTarget.key]?.platform === 'mac'" class="awake-lid"><input v-model="awakeLid" type="checkbox" :disabled="awakeByMachine[awakeTarget.key]?.battery?.source !== 'ac'"> {{ t('Capot fermé (sur secteur uniquement)') }}</label>
      <div class="session-list">
        <button v-for="choice in [{ mode: 'hour', label: t('1 heure') }, { mode: 'fourHours', label: t('4 heures') }, { mode: 'evening', label: t('Jusqu’à ce soir (20 h)') }, { mode: 'untilOff', label: t('Jusqu’à désactivation') }]" :key="choice.mode" class="session-choice" type="button" :disabled="awakeBusy" @click="chooseAwake(choice.mode as AwakeMode)"><b>{{ choice.label }}</b><UIcon name="i-lucide-chevron-right" /></button>
        <button v-if="awakeTarget && awakeByMachine[awakeTarget.key]?.active" class="session-choice" type="button" :disabled="awakeBusy" @click="chooseAwake('off')"><b>{{ t('Désactiver') }}</b><UIcon name="i-lucide-x" /></button>
      </div>
      <p class="awake-note">{{ tl('Sur batterie, fermer le capot met le Mac en veille. Une machine endormie ne peut pas être réveillée à distance.', 'Closing a Mac lid on battery puts it to sleep. A sleeping machine cannot be woken remotely.') }}</p>
    </AppSheet>
    <AppSheet v-model:open="diagnosticOpen" :title="t('Ce qui empêche la veille')">
      <p v-if="diagnosticBusy" class="session-intro">{{ t('Chargement…') }}</p>
      <div v-else class="session-list">
        <div v-for="(a, i) in assertions" :key="i" class="session-choice awake-assertion"><span><b>{{ a.ours ? t('wherdr · Garder éveillé') : a.name }}</b><small>{{ a.kind }} · {{ durationLabel(a.seconds) }}</small></span></div>
        <p v-if="!assertions.length" class="session-intro awake-empty">{{ t('Aucune app ne bloque la veille.') }}</p>
      </div>
    </AppSheet>
  </section>
</template>
