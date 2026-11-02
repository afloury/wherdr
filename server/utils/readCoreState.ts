import { coreCall } from './core'
import { coreState, type CoreMachine } from '../../shared/coreState'
import type { CoreInventory } from '../../shared/coreInventory'
import type { HerdrState } from '../../shared/types'

export async function readCoreState(previous: HerdrState): Promise<HerdrState> {
  try {
    const endpoint = process.env.HC_SOCKET
    if (!endpoint) throw new Error('Missing core endpoint')
    const [inventory, machines] = await Promise.all([
      coreCall<CoreInventory>(endpoint, 'terminal.list'),
      coreCall<{ machines: CoreMachine[] }>(endpoint, 'machine.list'),
    ])
    return coreState(inventory.terminals, machines.machines)
  } catch {
    return { ...previous, ok: false, ready: true, error: 'Cannot read herdr-core inventory',
      machines: previous.machines?.map(m => ({ ...m, status: 'offline' })) }
  }
}
