// File browser preferences, kept on the server so they follow the user across
// devices (FilesView.vue, useSyncedSettings.ts).

// Show the hidden files (name starting with a dot): shown by default.
export const SHOW_HIDDEN_KEY = 'wherdr.files.hidden'
export const readShowHidden = (raw: string | null): boolean => raw !== '0'
export const writeShowHidden = (show: boolean) => (show ? '1' : '0')

// A Markdown file: shown formatted ('rendered') or as its raw text with line
// numbers ('source'). Formatted by default.
export type MdView = 'rendered' | 'source'
export const MD_VIEW_KEY = 'wherdr.files.md'
export const readMdView = (raw: string | null): MdView => (raw === 'source' ? 'source' : 'rendered')
