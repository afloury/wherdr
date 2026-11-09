// Items lot G (WHR-244) adds to the agent "…" menu with herdr-core. See app/utils/coreAgentMenu.ts.
import { t } from '../i18n'
import type { CoreMenuContribution } from '../coreAgentMenu'

const contribute: CoreMenuContribution = ctx => ctx.pane
  ? [{ label: t('Browse files'), icon: 'i-lucide-folder-tree', run: ctx.browseFiles }]
  : []
export default contribute
