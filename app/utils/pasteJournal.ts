import { ref } from 'vue'

const KEY = 'pasteJournalEnabled'
function enabled() {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === '1' } catch { return false }
}
export const pasteJournalEnabled = ref(enabled())
export const pasteJournal = ref<{
  time: string, event: string, types: string[], textLength: number,
  prevented: boolean, focus: string, fieldFocused: boolean, modified: boolean,
  fieldLength: number, connected: boolean,
}[]>([])
export function setPasteJournal(value: boolean) {
  pasteJournalEnabled.value = value
  if (!value) pasteJournal.value = []
  try { localStorage.setItem(KEY, value ? '1' : '0') } catch { /* Device storage unavailable. */ }
}

// Keep only metadata in memory; never persist or log clipboard contents, IDs,
// field attributes or focus labels (which can themselves contain private text).
export function tracePaste(e: Event, data: DataTransfer | null, textLength: number, field: HTMLTextAreaElement, attachments: () => number) {
  if (!pasteJournalEnabled.value) return
  const before = field.value
  const count = attachments()
  const record = {
    time: new Date().toISOString(), event: e.type, types: [...(data?.types || [])], textLength,
    prevented: false, focus: document.activeElement?.tagName || 'NONE',
    fieldFocused: document.activeElement === field, modified: false,
    fieldLength: field.value.length, connected: field.isConnected,
  }
  // Native insertion runs after the handler; observe its result in the next task.
  setTimeout(() => {
    if (!pasteJournalEnabled.value) return
    record.prevented = e.defaultPrevented
    record.modified = field.value !== before || attachments() !== count
    record.fieldLength = field.value.length
    record.connected = field.isConnected
    pasteJournal.value = [...pasteJournal.value.slice(-49), record]
  }, 0)
}
