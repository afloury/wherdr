// État du verrouillage (public : l'écran de verrouillage en a besoin), avec le
// nom de la machine affiché dans l'app.
export default defineApi(event => ({ ...auth.status(reqOf(event)), hostLabel: localMachineLabel() }))
