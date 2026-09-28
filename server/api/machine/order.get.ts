import { readMachineOrder } from '../../utils/machineOrder'

export default defineApi(async () => ({ order: await readMachineOrder() }))
