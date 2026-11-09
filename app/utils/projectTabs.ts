// The project sheet's tabs (shared/pm/places.ts), and the one a URL asks for (`?tab=`): General by default.
import { PROJECT_TABS, type ProjectTab } from '#shared/pm/places'

export { PROJECT_TABS, PROJECT_TAB_LABEL, type ProjectTab } from '#shared/pm/places'
export const projectTab = (q: unknown): ProjectTab => (PROJECT_TABS as readonly unknown[]).includes(q) ? q as ProjectTab : 'general'
