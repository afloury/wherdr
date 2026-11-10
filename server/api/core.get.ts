import { defineEventHandler, setResponseHeader, setResponseStatus } from 'h3'
import { checkCore, CoreError } from '../utils/core'

// Guard middleware still enforces network, Host, Origin and passkey policy.
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'cache-control', 'no-store')
  try {
    const endpoint = process.env.HC_SOCKET
    if (!endpoint) throw new CoreError('configuration', 'Set HC_SOCKET on the wherdr server to select a herdr-core session.')
    return { ok: true, ...await checkCore(endpoint) }
  } catch (error) {
    setResponseStatus(event, 503)
    const e = error instanceof CoreError ? error : new CoreError('unavailable', 'Cannot connect to herdr-core')
    return { ok: false, error: e.message, kind: e.kind, hint: e.kind === 'incompatible' ? e.hint : undefined }
  }
})
