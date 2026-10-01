import { getQuery } from 'h3'
import { MACHINE_KEY_RE } from '../../../shared/ids'
import { HerdrError } from '../../utils/herdr'
import { getMachine } from '../../utils/machines'
import { awakeStatus, sleepAssertions } from '../../utils/awake'

export default defineApi(async event => {
  const query = getQuery(event)
  const key = typeof query.key === 'string' ? query.key : null
  if (key === null || (key !== '' && !MACHINE_KEY_RE.test(key))) throw new HerdrError('bad_machine', 'unknown machine')
  const machine = getMachine(key)
  if (!machine || machine.status !== 'online') throw new HerdrError('bad_machine', 'Machine unreachable')
  const status = await awakeStatus(machine)
  return { ...status, assertions: query.diagnostic === '1' ? await sleepAssertions(machine) : [] }
})
