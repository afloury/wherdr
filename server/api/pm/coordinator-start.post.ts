// { project, program, model }: starts the project's coordinator in its own
// folder, with its role files and a new token (the one before stops working).
import { coreAdminDeps } from '../../utils/coreAdminDeps'
import { startCoordinator } from '../../utils/pmCoordinator'
import { pmStore } from '../../utils/pmStore'

export default defineApi(async (_event, body) =>
  startCoordinator({ ...coreAdminDeps(), store: pmStore() }, body.project, body, `http://127.0.0.1:${process.env.PORT || '7683'}`))
