// Settings beside the conversation (computer, ≥ 1280 px): the panel lives in
// the conversation's own URL (`/a/<pane>?section=pacing`), so the sections and
// their sub-links (?project=…, ?group=…) work as on the full page.
import type { RouteLocationNormalized, RouteLocationRaw } from 'vue-router'

export const isConversationPath = (path: string) => /^\/(a|t)\/./.test(path)

// A move to /settings while a conversation is shown opens the panel instead,
// on the asked section (Appearance by default, or the one already open).
export function settingsPanelRoute(to: RouteLocationNormalized, from: RouteLocationNormalized, room: boolean): RouteLocationRaw | null {
  if (!room || !isConversationPath(from.path)) return null
  if (to.path !== '/settings' && to.path !== '/settings/desktop') return null
  const asked = to.path === '/settings/desktop' || to.query.section === 'desktop' ? 'conversation' : to.query.section
  const section = asked || from.query.section || 'appearance'
  return { path: from.path, query: { ...to.query, section } }
}
