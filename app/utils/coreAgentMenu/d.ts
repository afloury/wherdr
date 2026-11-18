// Split down (WHR-494) in the agent "…" menu with herdr-core. See app/utils/coreAgentMenu.ts.
import type { CoreMenuContribution } from '../coreAgentMenu'
import { splitDownItem } from '~/composables/useSpaces'

const contribute: CoreMenuContribution = ({ pane }) => (pane ? splitDownItem(pane) : [])
export default contribute
