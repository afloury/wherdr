// Sets (`max`: 1…99) or clears (`max: null`) the global thread limit of a machine.
import { validLimit } from '../../../shared/threadLimits'
import { HerdrError } from '../../utils/herdr'
import { currentMachineSlots, limitMachineKeys, readThreadLimits, writeThreadLimits } from '../../utils/threadLimits'

export default defineApi(async (_event, body) => {
  const key = body.machine
  const max = body.max
  if (typeof key !== 'string' || !limitMachineKeys().includes(key)) throw new HerdrError('bad_machine', 'Unknown machine')
  if (max !== null && !validLimit(max)) throw new HerdrError('bad_limit', 'Invalid thread limit')
  const limits = await readThreadLimits()
  if (max === null) delete limits[key]
  else limits[key] = max
  await writeThreadLimits(limits)
  return { machines: await currentMachineSlots() }
})
