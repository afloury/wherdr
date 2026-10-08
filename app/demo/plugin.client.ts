// Demo build only (VITE_WHERDR_DEMO=1, see nuxt.config.ts): replaces the
// network with the in-browser fake server before anything else runs, and
// shows the demo strip.
import { createApp } from 'vue'
import DemoBanner from './DemoBanner.vue'
import { installDemoNetwork } from './shim'

export default defineNuxtPlugin({
  name: 'wherdr-demo',
  enforce: 'pre',
  setup(nuxtApp) {
    installDemoNetwork(useRuntimeConfig().app.baseURL)
    nuxtApp.hook('app:mounted', () => {
      const el = document.createElement('div')
      document.body.appendChild(el)
      createApp(DemoBanner).mount(el)
    })
  },
})
