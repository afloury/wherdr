import { coreAdminDeps } from '../../utils/coreAdminDeps'
import { coreAddMachine } from '../../utils/coreCreate'

export default defineApi((_event, body) => coreAddMachine(coreAdminDeps(), body))
