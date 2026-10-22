import { HerdrError } from '../../utils/herdr'
import { machineDiagnostic } from '../../utils/machines'

export default defineApi(async (_event, body) => {
  if (typeof body.key !== 'string') throw new HerdrError('bad_machine', 'unknown remote machine')
  return machineDiagnostic(body.key)
})
