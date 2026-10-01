import { validMachineOrder } from '../../../shared/machineOrder'
import { HerdrError } from '../../utils/herdr'
import { currentMachineKeys, writeMachineOrder } from '../../utils/machineOrder'

export default defineApi(async (_event, body) => {
  const order: unknown = body.order
  if (!validMachineOrder(order, currentMachineKeys())) throw new HerdrError('bad_machine_order', 'Invalid machine order')
  await writeMachineOrder(order)
  return { order }
})
