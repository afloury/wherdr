// Global thread limit per machine: saved limits and open threads (all projects).
import { currentMachineSlots } from '../../utils/threadLimits'

export default defineApi(async () => ({ machines: await currentMachineSlots() }))
