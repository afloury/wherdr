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
const sections = computed(() => {
  if (!multiMachine.value) return null
  return machines.value.map((m) => {
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
  // Actions globales des plugins Herdr de cette machine.
  if (m.status === 'online' && machinePluginActions(m.key).length) {
    items.push({ label: t('Actions des plugins'), icon: 'i-lucide-puzzle', run: () => openPluginMenu({ machine: m.key }) })
  }
  return toDropdown(items)
}
// Actions des plugins de chaque machine en ligne (une seule : la locale).
const onlineKeys = computed(() => JSON.stringify(multiMachine.value ? machines.value.filter(m => m.status === 'online').map(m => m.key) : (st.value.ok ? [''] : [])))
watch(onlineKeys, (keys) => { for (const k of JSON.parse(keys) as string[]) loadPluginActions(k) }, { immediate: true })
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
      <button v-if="!multiMachine" type="button" class="solo-session-row" :aria-label="t('Sessions Herdr')" @click="openSessions(soloMachine)">
        <span><UIcon name="i-lucide-layers" />{{ soloMachine.label }}</span>
        <b>{{ soloMachine.session || 'default' }}<UIcon name="i-lucide-chevron-right" /></b>
      </button>

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
          v-for="s in sections" :key="s.m.key" class="machine" :class="[s.m.status, { collapsed: s.collapsed }]"
          :data-machine="s.m.key || 'local'"
        >
          <div class="machine-row">
            <button
              type="button" class="machine-head" :aria-expanded="!s.collapsed"
              :title="s.m.target ? `ssh ${s.m.target}` : undefined" @click="toggleMachine(s.m.key)"
            >
              <UIcon name="i-lucide-chevron-down" class="machine-chev" />
              <UIcon :name="s.m.local ? 'i-lucide-server' : 'i-lucide-laptop'" class="machine-icon" />
              <span class="machine-name">{{ s.name }}<small v-if="s.m.session && s.m.session !== 'default'" class="machine-session">{{ s.m.session }}</small></span>
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
  </section>
</template>
