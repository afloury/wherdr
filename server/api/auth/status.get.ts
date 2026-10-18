import { checkRequestClient } from '../../utils/network'

// Lock state (public: the lock screen needs it), with the machine name shown
// in the app. Also slides an unlocked session; `?resume=1` (app opening or back
// in the foreground) ends a session past its maximum duration.
// `setup`: no passkey yet and an unverified provenance (Tailscale Funnel, or
// Docker's gateway): the app shows the first-passkey screen instead.
export default defineApi((event) => {
  const status = auth.status(reqOf(event), { resume: getQuery(event).resume === '1' })
  const check = checkRequestClient(event.node.req.socket?.remoteAddress, event.node.req.headers)
  const setup = !status.enabled && check.ok && check.zone === 'unverified' ? { unlocked: false, setup: check.why } : {}
  return { ...status, ...setup, hostLabel: localMachineLabel() }
})
