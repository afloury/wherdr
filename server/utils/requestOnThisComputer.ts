import type { H3Event } from 'h3'
import { checkRequestClient } from './network'

// Whether this request comes straight from a browser on the computer wherdr runs on
// (loopback, nothing forwarded from elsewhere).
export function requestOnThisComputer(event: H3Event): boolean {
  const check = checkRequestClient(event.node.req.socket?.remoteAddress, event.node.req.headers, auth.isEnabled())
  return check.ok && check.zone === 'local'
}
