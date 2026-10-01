import { MACHINE_KEY_RE } from '../../../shared/ids'
import { HerdrError } from '../../utils/herdr'
import { getMachine } from '../../utils/machines'
import { setAwake, type AwakeMode } from '../../utils/awake'

const MODES = new Set(['off', 'hour', 'fourHours', 'evening', 'untilOff', 'extend'])
export default defineApi(async (_event, body) => {
  const key = typeof body.key === 'string' ? body.key : null
  if (key === null || (key !== '' && !MACHINE_KEY_RE.test(key))) throw new HerdrError('bad_machine', 'unknown machine')
  const machine = getMachine(key)
  if (!machine || machine.status !== 'online') throw new HerdrError('bad_machine', 'machine injoignable')
  const mode = typeof body.mode === 'string' ? body.mode : ''
  if (!MODES.has(mode) || typeof body.lid !== 'boolean') throw new HerdrError('bad_mode', 'Invalid keep-awake option')
  return setAwake(machine, mode as AwakeMode | 'off', body.lid)
})
