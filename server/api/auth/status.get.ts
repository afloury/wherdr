// Lock state (public: the lock screen needs it). Unlocked, it also carries the
// machine name shown in the app; locked, only what the lock screen needs.
// Also slides an unlocked session; `?resume=1` (app opening or back in the
// foreground) ends a session past its maximum duration.
export default defineApi((event) => {
  const st = auth.status(reqOf(event), { resume: getQuery(event).resume === '1' })
  return st.unlocked ? { ...st, hostLabel: localMachineLabel() } : st
})
