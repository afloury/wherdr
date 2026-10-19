// Lock state (public: the lock screen needs it), with the machine name shown
// in the app. Also slides an unlocked session; `?resume=1` (app opening or back
// in the foreground) ends a session past its maximum duration.
export default defineApi(event => ({
  ...auth.status(reqOf(event), { resume: getQuery(event).resume === '1' }),
  hostLabel: localMachineLabel(),
}))
