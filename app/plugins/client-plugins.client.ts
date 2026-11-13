// Loads the wherdr plugins (DATA_DIR/plugins) once the app is up. No plugin, no effect.
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook('app:mounted', () => { startClientPlugins() })
})
