// Items lot E (WHR-244) adds to the agent "…" menu with herdr-core. See app/utils/coreAgentMenu.ts.
import type { CoreMenuContribution } from '../coreAgentMenu'
import { t } from '../i18n'

const contribute: CoreMenuContribution = ({ pane, rename }) => pane
  ? [{ label: t('Rename pane'), icon: 'i-lucide-pencil', run: () => rename(pane.id) }]
  : []
export default contribute
