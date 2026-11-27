import type { H3Event } from 'h3'
import { fromThisComputer, netContext } from './network'

// Whether this request comes from a browser on the computer wherdr runs on.
export const requestOnThisComputer = (event: H3Event) =>
  fromThisComputer(event.node.req.socket?.remoteAddress, event.node.req.headers, { ...netContext(), passkey: auth.isEnabled() })
