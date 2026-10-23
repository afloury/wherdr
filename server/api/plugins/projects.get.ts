import { MACHINE_KEY_RE } from '../../../shared/ids'
import { HerdrError } from '../../utils/herdr'
import { getMachine } from '../../utils/machines'
import { projectsPluginState } from '../../utils/projectsPlugin'
import { projectsProgramVersion } from '../../utils/projectsTasks'

export default defineApi(async (event) => {
  const key = getQuery(event).machine
  if (typeof key !== 'string' || (key !== '' && !MACHINE_KEY_RE.test(key))) throw new HerdrError('bad_machine', 'unknown machine')
  const machine = getMachine(key)
  if (!machine) throw new HerdrError('bad_machine', 'unknown machine')
  const state = await projectsPluginState(machine)
  // Only a 1.x wherdr runs: what it really is decides whether to offer an update.
  const program = state.status === 'ready' ? await projectsProgramVersion(machine).catch(() => null) : null
  return { ...state, program }
})
