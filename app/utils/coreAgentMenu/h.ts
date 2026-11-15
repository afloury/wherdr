// "Keep after restart" (terminal.keep, WHR-252) in the agent "…" menu with herdr-core.
import { t } from '../i18n'
import type { CoreMenuContribution } from '../coreAgentMenu'

const contribute: CoreMenuContribution = ({ keep }) => keep
  ? [{
      label: keep.on ? t('Keep after restart: on') : t('Keep after restart: off'), icon: keep.on ? 'i-lucide-pin' : 'i-lucide-pin-off',
      desc: t('A kept terminal comes back as a shell after a herdr-core restart.'), run: keep.toggle,
    }]
  : []
export default contribute
