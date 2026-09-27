import { MACHINE_KEY_RE } from '../../../shared/ids'
import { HerdrError } from '../../utils/herdr'
import { getMachine } from '../../utils/machines'
import { projectsPluginState } from '../../utils/projectsPlugin'

export default defineApi(async (event) => {
  const key = getQuery(event).machine
  if (typeof key !== 'string' || (key !== '' && !MACHINE_KEY_RE.test(key))) throw new HerdrError('bad_machine', 'machine inconnue')
  const machine = getMachine(key)
  if (!machine) throw new HerdrError('bad_machine', 'machine inconnue')
  return projectsPluginState(machine)
})
