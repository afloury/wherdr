// The Notes panel (NotesPanel.vue): open or not, its filter (kept on the
// server, like the Board's project picker), and the notes, read again every
// few seconds while it is open so an agent's change shows without a reload.
import { NOTES_FOLLOW, type Note } from '#shared/notes'
import { BAR_ALL } from '~/utils/machineBar'
import { syncedRef } from './useSyncedSettings'

export const notesOpen = ref(false)
export const notesFilter = syncedRef<string>('notesFilter', raw => raw || NOTES_FOLLOW, v => (v === NOTES_FOLLOW ? null : v))
export const notes = ref<Note[] | null>(null)
// The groups of the home tab picked: a group, the groups holding a machine,
// or null for every machine.
export const notesTabGroups = computed(() => {
  const pick = machineBarPick.value
  if (pick === null || pick === BAR_ALL) return null
  const g = machineGroups.value.find(x => x.id === pick)
  return g ? [g.id] : machineGroups.value.filter(x => x.machines.includes(pick)).map(x => x.id)
})

export const loadNotes = () => api<Note[]>('/api/notes').then((n) => { notes.value = n }, () => {})
export function toggleNotes() { notesOpen.value = !notesOpen.value }
