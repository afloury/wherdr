// Largeur du contenu sur ordinateur (conversation, terminal, réglages…), réglage de l'appareil.
export type ContentWidth = 'normal' | 'wide' | 'full'

export const CONTENT_WIDTHS: readonly ContentWidth[] = ['normal', 'wide', 'full']

export function readContentWidth(raw: string | null): ContentWidth {
  return CONTENT_WIDTHS.includes(raw as ContentWidth) ? raw as ContentWidth : 'normal'
}

// La nouvelle préférence prime ; une installation existante garde son choix.
export function migrateContentWidth(current: string | null, legacy: string | null): ContentWidth {
  return readContentWidth(current ?? legacy)
}
