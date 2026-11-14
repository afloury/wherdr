// "New wherdr version" notice (/api/update): loaded once per opening
// of the app (the server only asks GitHub once a day). "Hide"
// lasts until the next version, on this device.
// One-tap update (Update button, server/utils/selfupdate.ts): the Updating
// screen polls /api/update/status while wherdr restarts, then reloads on the
// new version or shows why it rolled back.
import { updateRunning, type UpdateInfo, type UpdateJob } from '#shared/updates'

const DISMISS_KEY = 'wherdr.update.dismissed'
const MAJOR_DISMISS_KEY = 'wherdr.update.major.dismissed'
export const updateInfo = ref<UpdateInfo | null>(null)
const dismissed = ref<string>('')
const majorDismissed = ref<string>('')
let loaded = false

export function loadUpdate() {
  if (loaded) return
  loaded = true
  try {
    dismissed.value = localStorage.getItem(DISMISS_KEY) || ''
    majorDismissed.value = localStorage.getItem(MAJOR_DISMISS_KEY) || ''
  } catch { /* storage unavailable */ }
  api<UpdateInfo>('/api/update').then((u) => { updateInfo.value = u }).catch(() => { loaded = false })
}

// A newer major (wherdr 3) to announce on the home screen, instead of the
// update banner (hideable until the next one).
export const majorCard = computed(() => {
  const next = updateInfo.value?.nextMajor
  return next && next.version !== majorDismissed.value ? next : null
})

// New version of the running major to announce on the home screen (hideable).
export const updateBanner = computed(() => {
  const u = updateInfo.value
  return !majorCard.value && u?.latest && u.latest !== dismissed.value ? u : null
})

export function dismissMajor() {
  const v = updateInfo.value?.nextMajor?.version
  if (!v) return
  majorDismissed.value = v
  try { localStorage.setItem(MAJOR_DISMISS_KEY, v) } catch { /* storage unavailable */ }
}

export function dismissUpdate() {
  const v = updateInfo.value?.latest
  if (!v) return
  dismissed.value = v
  try { localStorage.setItem(DISMISS_KEY, v) } catch { /* stockage indisponible */ }
}

// The Updating screen: open from the tap until the new version loads, or
// until the user closes the result of a failed update.
export const selfUpdate = reactive<{ open: boolean, to: string, job: UpdateJob | null, error: string, timedOut: boolean }>({
  open: false, to: '', job: null, error: '', timedOut: false,
})

// wherdr has 60 s to answer after its restart, plus the install itself.
const GIVE_UP_MS = 5 * 60_000
const POLL_MS = 2000

export async function runSelfUpdate(info: UpdateInfo) {
  const to = info.latest
  if (!to) return
  const ok = await askConfirm(tl(`Update wherdr to ${to}? It restarts in a few seconds.`, `Mettre à jour wherdr en ${to} ? Il redémarre dans quelques secondes.`), t('Update'), 'primary')
  if (!ok) return
  Object.assign(selfUpdate, { open: true, to, job: null, error: '', timedOut: false })
  try {
    const r = await api<{ job: UpdateJob }>('/api/update', { version: to })
    selfUpdate.job = r.job
  } catch (e) {
    selfUpdate.error = (e as Error).message
    return
  }
  const startedAt = Date.now()
  while (selfUpdate.open) {
    await new Promise(r => setTimeout(r, POLL_MS))
    let status: { version: string, job: UpdateJob | null } | null = null
    try { status = await api('/api/update/status') } catch (e) {
      // A target older than this screen (no status route): its version from /api/update.
      // Otherwise unreachable while it restarts: keep waiting.
      const u = (e as ApiError).status === 404 ? await api<UpdateInfo>('/api/update').catch(() => null) : null
      if (u?.current === to && selfUpdate.job) status = { version: to, job: { ...selfUpdate.job, state: 'done' } }
    }
    if (status?.job && status.job.to === to) selfUpdate.job = status.job
    const job = selfUpdate.job
    if (status?.version === to && job?.state === 'done') {
      // The new server serves a new build: let the service worker take it, then reload.
      await checkNewVersion()
      await applyNewVersion()
      return
    }
    if (job && !updateRunning(job, Date.now()) && job.state !== 'done') return
    if (Date.now() - startedAt > GIVE_UP_MS) {
      selfUpdate.timedOut = true
      return
    }
  }
}

export function closeSelfUpdate() {
  selfUpdate.open = false
  // The banner shows what is installed now.
  loaded = false
  loadUpdate()
}
