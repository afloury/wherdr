import { coreAdminDeps } from '../utils/coreAdminDeps'
import { coreCreate } from '../utils/coreCreate'

export default defineApi((_event, b) => coreCreate(coreAdminDeps(), b))
