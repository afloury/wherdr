import { coreAdminDeps } from '../../utils/coreAdminDeps'
import { coreStatus } from '../../utils/coreCreate'

export default defineApi(() => coreStatus(coreAdminDeps()))
