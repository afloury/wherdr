import { MACHINE_KEY_RE } from '../../../shared/ids'
import { HerdrError } from '../../utils/herdr'
import { getMachine } from '../../utils/machines'
import { installProjectsPlugin, updateProjectsPlugin } from '../../utils/projectsPlugin'
import { projectsProgramVersion } from '../../utils/projectsTasks'

// { machine }: install herdr-projects; { machine, update: true }: update an
// older 1.x to the release wherdr was tested with.
export default defineApi(async (_event, body) => {
  const key = body.machine
  if (typeof key !== 'string' || (key !== '' && !MACHINE_KEY_RE.test(key))) throw new HerdrError('bad_machine', 'unknown machine')
  const machine = getMachine(key)
  if (!machine) throw new HerdrError('bad_machine', 'unknown machine')
  if (body.update === true) {
    const program = await projectsProgramVersion(machine).catch(() => null)
    return { output: await updateProjectsPlugin(machine, program) }
  }
  return { output: await installProjectsPlugin(machine) }
})
