// Panneau « Projet » d'un coordinateur herdr-projects : état du projet (TASKS.md
// et threads), lu à l'ouverture, puis :
//  - sondage léger toutes les 15 s tant que le panneau est visible (le serveur
//    compare seulement la date de TASKS.md et du dossier des threads) ;
//  - relecture complète quand un agent du projet change d'état.
// Rien n'apparaît sans herdr-projects sur la machine (`available: false`).
import type { Pane } from '#shared/types'
import type { ProjectBoard } from '#shared/projectBoard'
import { isCoordinator, projectOf } from '#shared/projects'

type Reply = ProjectBoard | { same: true, version: string } | { available: false }

const POLL_MS = 15000
// Dernier état connu par pane : pas de clignotement de l'onglet en rouvrant la vue.
const known = new Map<string, ProjectBoard | false>()

export function useProjectBoard(paneId: () => string, visible: () => boolean) {
  const pane = computed<Pane | undefined>(() => herdrState.value.panes.find(p => p.id === paneId()))
  const coordinator = computed(() => Boolean(pane.value && isCoordinator(pane.value)))
  const cached = known.get(paneId())
  const board = shallowRef<ProjectBoard | null>(cached || null)
  const available = ref(cached === undefined ? null as boolean | null : Boolean(cached))
  const loading = ref(false)
  const error = ref('')
  let seq = 0

  async function load(full = false) {
    if (!coordinator.value || offlineView.value) return
    const id = ++seq
    loading.value = true
    try {
      const since = !full && board.value ? `&since=${encodeURIComponent(board.value.version)}` : ''
      const r = await api<Reply>(`/api/project?pane=${encodeURIComponent(paneId())}${since}`)
      if (id !== seq) return
      error.value = ''
      if ('available' in r) {
        available.value = false
        board.value = null
        known.set(paneId(), false)
      } else if (!('same' in r)) {
        available.value = true
        board.value = r
        known.set(paneId(), r)
      }
    } catch (e) {
      if (id !== seq) return
      error.value = (e as Error).message
      // Première lecture ratée (serveur qui démarre, pane pas encore connu de
      // lui) : nouvel essai rapide au lieu d'attendre le prochain sondage.
      if (available.value === null && !retry) retry = setTimeout(() => { retry = null; load() }, 3000)
    } finally {
      if (id === seq) loading.value = false
    }
  }

  // Agents du projet : leur état change (thread qui finit, qui attend) -> relecture.
  const projectStates = computed(() => {
    const slug = pane.value && projectOf(pane.value)?.toLowerCase()
    if (!slug) return ''
    return herdrState.value.panes
      .filter(p => p.id !== paneId() && projectOf(p)?.toLowerCase() === slug)
      .map(p => `${p.id}=${p.status}`).sort().join(',')
  })
  let stateTimer: ReturnType<typeof setTimeout> | null = null
  watch(projectStates, (now, before) => {
    if (!before || !available.value) return
    if (stateTimer) clearTimeout(stateTimer)
    // herdr-projects voit le nouvel état à son prochain passage : on lui laisse un instant.
    stateTimer = setTimeout(() => { if (visible()) load(true) }, 2500)
  })

  let poll: ReturnType<typeof setInterval> | null = null
  let retry: ReturnType<typeof setTimeout> | null = null
  function stopPoll() {
    if (poll) clearInterval(poll)
    if (retry) clearTimeout(retry)
    poll = null
    retry = null
  }
  // Décision réévaluée à chaque arrivée d'état (pane connu, passage du hors
  // ligne au direct, panneau montré) : jamais figée au montage.
  const mode = computed(() => refreshMode({
    coordinator: coordinator.value,
    offline: offlineView.value,
    visible: visible(),
    pageVisible: pageVisible.value,
    available: available.value,
  }))
  watch(mode, (m) => {
    stopPoll()
    if (m === 'none') return
    load()
    if (m === 'poll') poll = setInterval(() => load(), POLL_MS)
  }, { immediate: true })

  onUnmounted(() => {
    seq++
    stopPoll()
    if (stateTimer) clearTimeout(stateTimer)
  })

  return { board, available, loading, error, reload: () => load(true), coordinator }
}

// Rapport d'un thread (Markdown), lu à la demande.
export function fetchThreadReport(paneId: string, id: string) {
  return api<{ id: string, text: string, truncated: boolean }>(`/api/project/report?pane=${encodeURIComponent(paneId)}&id=${encodeURIComponent(id)}`)
}
