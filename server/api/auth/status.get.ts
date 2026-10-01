// Lock state (public: the lock screen needs it), with the
// machine name shown in the app.
export default defineApi(event => ({ ...auth.status(reqOf(event)), hostLabel: localMachineLabel() }))
