// "New wherdr version" notice (/api/update): loaded once per opening
// of the app (the server only asks GitHub once a day). "Hide"
// lasts until the next version, on this device.
// herdr-core never offers the one-tap update (GET /api/update answers
// oneTap: false): the banner shows the update command instead.
import type { UpdateInfo, UpdateJob } from '#shared/updates'

const DISMISS_KEY = 'wherdr.update.dismissed'
export const updateInfo = ref<UpdateInfo | null>(null)
const dismissed = ref<string>('')
let loaded = false

export function loadUpdate() {
  if (loaded) return
  loaded = true
  try { dismissed.value = localStorage.getItem(DISMISS_KEY) || '' } catch { /* stockage indisponible */ }
  api<UpdateInfo>('/api/update').then((u) => { updateInfo.value = u }).catch(() => { loaded = false })
}

// New version to announce on the home screen (hideable).
export const updateBanner = computed(() => {
  const u = updateInfo.value
  return u?.latest && u.latest !== dismissed.value ? u : null
})

export function dismissUpdate() {
  const v = updateInfo.value?.latest
  if (!v) return
  dismissed.value = v
  try { localStorage.setItem(DISMISS_KEY, v) } catch { /* stockage indisponible */ }
}

// The old Updating screen's state (SelfUpdateScreen.vue, left for its own removal).
export const selfUpdate = reactive<{ open: boolean, to: string, job: UpdateJob | null, error: string, timedOut: boolean }>({
  open: false, to: '', job: null, error: '', timedOut: false,
})

export function closeSelfUpdate() {
  selfUpdate.open = false
  // The banner shows what is installed now.
  loaded = false
  loadUpdate()
}
