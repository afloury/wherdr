// Split down (WHR-494) in the agent "…" menu with herdr-core. See app/utils/coreAgentMenu.ts.
import type { CoreMenuContribution } from '../coreAgentMenu'

const contribute: CoreMenuContribution = ({ split }) => split ?? []
export default contribute
