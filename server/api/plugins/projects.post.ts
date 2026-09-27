import { MACHINE_KEY_RE } from '../../../shared/ids'
import { HerdrError } from '../../utils/herdr'
import { getMachine } from '../../utils/machines'
import { installProjectsPlugin } from '../../utils/projectsPlugin'

export default defineApi(async (_event, body) => {
  const key = body.machine
  if (typeof key !== 'string' || (key !== '' && !MACHINE_KEY_RE.test(key))) throw new HerdrError('bad_machine', 'machine inconnue')
  const machine = getMachine(key)
  if (!machine) throw new HerdrError('bad_machine', 'machine inconnue')
  return { output: await installProjectsPlugin(machine) }
})
