import { HerdrError } from '../../utils/herdr'
import { currentMachineKeys, writeMachineOrder } from '../../utils/machineOrder'

export default defineApi(async (_event, body) => {
  const order: unknown = body.order
  const known = currentMachineKeys()
  if (!Array.isArray(order) || order.length > known.length ||
    order.some(key => typeof key !== 'string' || !known.includes(key)) ||
    new Set(order).size !== order.length) {
    throw new HerdrError('bad_machine_order', 'ordre des machines invalide')
  }
  await writeMachineOrder(order)
  return { order }
})
