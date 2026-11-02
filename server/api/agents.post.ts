import { coreAdminDeps } from '../utils/coreAdminDeps'
import { coreCreate } from '../utils/coreCreate'

export default defineApi((event, b) => process.env.WHERDR_BACKEND === 'core' ? coreCreate(coreAdminDeps(), b) : createAgent(b))
