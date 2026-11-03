// "…" menu of an agent with herdr-core (WHR-244). The base items live here; a
// lot adds its own in app/utils/coreAgentMenu/<lot>.ts, so AgentView.vue stays
// untouched by those lots.
import { t } from './i18n'
import type { MenuItem } from '~/composables/useUi'
import type { Pane } from '#shared/types'
import d from './coreAgentMenu/d'
import e from './coreAgentMenu/e'
import f from './coreAgentMenu/f'
import g from './coreAgentMenu/g'

export interface CoreMenuContext {
  pane: Pane | undefined
  /** Take control of the terminal / reconnect it (they live in AgentView). */
  takeControl: () => void
  reconnect: () => void
  /** Opens the file browser of the agent's folder. */
  browseFiles: () => void
  /** Settings entries (not in a side-by-side cell), already built. */
  settings: MenuItem[]
  /** Close entry, absent on the compact phone. */
  close: MenuItem | undefined
}

export type CoreMenuContribution = (ctx: CoreMenuContext) => MenuItem[]

const CONTRIBUTIONS: CoreMenuContribution[] = [d, e, f, g]

export function coreAgentMenu(ctx: CoreMenuContext): MenuItem[] {
  const items: MenuItem[] = [
    { label: t('Take control of this terminal'), icon: 'i-lucide-arrow-left-right', run: ctx.takeControl },
    { label: t('Reconnect'), icon: 'i-lucide-refresh-cw', run: ctx.reconnect },
  ]
  for (const contribute of CONTRIBUTIONS) items.push(...contribute(ctx))
  items.push(...ctx.settings)
  if (ctx.close) items.push({ kind: 'separator' }, ctx.close)
  return items
}
