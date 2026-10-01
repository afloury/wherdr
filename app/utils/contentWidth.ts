// Content width on a computer (conversation, terminal, settings…), device setting.
export type ContentWidth = 'normal' | 'wide' | 'full'

export const CONTENT_WIDTHS: readonly ContentWidth[] = ['normal', 'wide', 'full']

export function readContentWidth(raw: string | null): ContentWidth {
  return CONTENT_WIDTHS.includes(raw as ContentWidth) ? raw as ContentWidth : 'normal'
}

// The new preference wins; an existing installation keeps its choice.
export function migrateContentWidth(current: string | null, legacy: string | null): ContentWidth {
  return readContentWidth(current ?? legacy)
}
