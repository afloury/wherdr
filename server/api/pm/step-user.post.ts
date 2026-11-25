// { id }: the user's button on the task's current step ("Merged", "OK").
import { coreAdminDeps } from '../../utils/coreAdminDeps'
import { userStep } from '../../utils/pmBoard'
import { pmStore } from '../../utils/pmStore'
import { publicTask } from '../../../shared/pm/run'
import { userActedOn } from '../../utils/pmReply'

export default defineApi(async (_event, body) => {
  const task = await userStep({ ...coreAdminDeps(), store: pmStore() }, body.id)
  // The step's action refused (the task stays the user's turn): nothing was answered.
  if (task.step?.yourTurn?.reason !== 'action') await userActedOn(pmStore(), task.id, 'step').catch(() => {})
  return { task: publicTask(task) }
})
