import { createError, defineEventHandler, getQuery, setResponseHeader } from 'h3'
import { coreCall, CoreError } from '../../utils/core'
import type { CoreInventory, CoreTerminal } from '../../../shared/coreInventory'

export default defineEventHandler(async event => {
  setResponseHeader(event, 'cache-control', 'no-store')
  const terminal = getQuery(event).terminal
  if (terminal !== undefined && (typeof terminal !== 'string' || !terminal.length || terminal.length > 256 || /[\x00-\x1f\x7f]/.test(terminal))) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid terminal address' })
  }
  const endpoint = process.env.HC_SOCKET
  if (!endpoint) throw createError({ statusCode: 503, statusMessage: 'herdr-core inventory is unavailable' })
  try {
    if (terminal !== undefined) return await coreCall<CoreTerminal>(endpoint, 'terminal.get', { terminal })
    const list = await coreCall<Partial<CoreInventory>>(endpoint, 'terminal.list')
    if (!Array.isArray(list?.terminals)) throw new CoreError('protocol', 'Invalid terminal list')
    // hc 0.1.16 omits `machines` when none is configured, although its schema requires it.
    return { terminals: list.terminals, machines: list.machines ?? [], hidden_finished: list.hidden_finished ?? 0 } satisfies CoreInventory
  } catch (error) {
    const kind = error instanceof CoreError ? error.kind : 'unavailable'
    // An address on a renamed or removed machine no longer resolves either.
    const gone = kind === 'not_found' || kind === 'machine_unknown'
    throw createError({ statusCode: gone ? 404 : 503,
      statusMessage: gone ? 'Terminal no longer exists' : 'Cannot read herdr-core inventory' })
  }
})
