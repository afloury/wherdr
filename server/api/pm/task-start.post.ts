// { id, machine? }: starts the task's worker, on `machine` (a key its project
// allows) for a task that never started, else where placement puts it; a
// started task goes back to its own. Answers with the task: 'working', or
// 'waiting' with the reason it could not start. The user's start always goes;
// when it fits no machine now, `memory` says so (also in the task's log).
import { coreAdminDeps } from '../../utils/coreAdminDeps'
import { startTask } from '../../utils/pmLaunch'
import { forgetMemory } from '../../utils/pmMemory'
import { goesTo, placeFor } from '../../utils/pmPlace'
import { pmStore } from '../../utils/pmStore'
import { publicTask } from '../../../shared/pm/run'

export default defineApi(async (event, body) => {
  const deps = { ...coreAdminDeps(), store: pmStore(), origin: getRequestURL(event).origin }
  const before = await deps.store.task(body.id)
  const { on, short } = before && before.state !== 'working' ? goesTo(await placeFor(deps, before, typeof body.machine === 'string' ? { asked: body.machine } : {})) : { on: undefined, short: undefined }
  let task = await startTask(deps, body.id, on !== undefined ? { on } : {})
  if (on !== undefined) forgetMemory(on)
  if (short) task = await deps.store.logTask(task, 'user', `${short}: started anyway, as the user asked`)
  return { task: publicTask(task), ...(short ? { memory: `${short}: started anyway` } : {}) }
})
