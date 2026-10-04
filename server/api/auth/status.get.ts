// Lock state (public: the lock screen needs it), with the
// machine name shown in the app. Also slides an unlocked session.
export default defineApi((event) => {
  const req = reqOf(event)
  const renewed = auth.renew(req)
  const st = { ...auth.status(req), hostLabel: localMachineLabel() }
  return renewed ? { ...st, expiresAt: renewed.expiresAt, __cookie: renewed.cookie } : st
})
