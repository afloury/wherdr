// The notes agents wrote (shared/notes.ts), newest first, for the Notes
// panel: read-only for the user.
import { notesStore } from '../utils/notesStore'

export default defineApi(() => notesStore().list())
