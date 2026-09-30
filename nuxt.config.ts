// wherdr (herdr-web) — PWA pour piloter depuis le téléphone les agents de code qui tournent dans Herdr.
// App cliente (pas de SSR) servie par Nitro, qui porte aussi toute la
// passerelle Herdr (API, WebSockets, Web Push) : cf. server/.
import { CSP_BASE } from './server/utils/csp'
export default defineNuxtConfig({
  ssr: false,
  modules: ['@nuxt/ui', '@vite-pwa/nuxt'],
  css: ['~/assets/css/main.css'],
  typescript: { strict: true },
  devtools: { enabled: false },
  telemetry: false,

  // Thème sombre fixe ; polices embarquées (@fontsource, cf. main.css), jamais chargées depuis le réseau.
  ui: {
    colorMode: false,
    fonts: false,
    theme: { colors: ['primary', 'neutral', 'success', 'warning', 'error', 'info'] },
  },

  // Icônes embarquées dans le bundle : aucun appel réseau à l'exécution
  // (l'API d'icônes serait d'ailleurs derrière le verrouillage).
  icon: {
    provider: 'none',
    fallbackToApi: false,
    serverBundle: false,
    customCollections: [{ prefix: 'herdr', dir: './app/assets/icons' }],
    clientBundle: {
      scan: true,
      includeCustomCollections: true,
      // Icônes utilisées par les composants de Nuxt UI (fermer, cocher…).
      icons: [
        'lucide:x', 'lucide:check', 'lucide:chevron-down', 'lucide:chevron-up', 'lucide:chevron-right',
        'lucide:chevron-left', 'lucide:loader-circle', 'lucide:info', 'lucide:circle-alert',
        'lucide:triangle-alert', 'lucide:circle-check', 'lucide:circle-x', 'lucide:minus',
        'lucide:arrow-left', 'lucide:arrow-right', 'lucide:search', 'lucide:ellipsis',
        // Machines (noms calculés, pas toujours vus par le scan).
        'lucide:server', 'lucide:laptop', 'lucide:unplug',
        // Menus d'espace (app/composables/useSpaces.ts : les composables ne sont pas scannés).
        'lucide:columns-2', 'lucide:rows-2', 'lucide:move', 'lucide:square-plus', 'lucide:panels-top-left',
      ],
    },
  },

  // Adresses en #/… : les liens des notifications déjà envoyées (/#/a/<pane>)
  // et l'icône installée restent valables.
  router: { options: { hashMode: true } },

  app: {
    head: {
      title: 'wherdr',
      htmlAttrs: { lang: 'en', class: 'dark' },
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content' },
        { name: 'description', content: 'Control your Herdr code agents' },
        // theme-color et color-scheme : posés par app.vue selon le thème choisi.
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'mobile-web-app-capable', content: 'yes' },
        // « black » et non « black-translucent » : en translucide, iOS 26 raccourcit
        // l'app installée de la hauteur de la barre d'état… par le bas (894 px sur 956).
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black' },
        { name: 'apple-mobile-web-app-title', content: 'wherdr' },
        { name: 'robots', content: 'noindex, nofollow' },
      ],
      // Le manifeste (FR ou EN selon la langue choisie) est ajouté par app.vue.
      link: [
        // Icône de l'app (« >_ » + point orange). Une installation peut la remplacer sans
        // toucher au code : cf. docker-compose.override.example.yml (dossier branding/).
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/icons/favicon-32.png?v=4' },
        { rel: 'icon', type: 'image/png', sizes: '192x192', href: '/icons/icon-192.png?v=4' },
        { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png?v=4' },
      ],
    },
  },

  // Service worker maison (app/service-worker/sw.ts), compilé par vite-pwa en
  // injectManifest. Les manifestes FR/EN sont des fichiers de public/.
  pwa: {
    strategies: 'injectManifest',
    srcDir: 'service-worker',
    filename: 'sw.ts',
    injectRegister: false,
    manifest: false,
    registerWebManifestInRouteRules: true,
    injectManifest: {
      rollupFormat: 'iife',
      minify: false,
      // Polices comprises (≈ 400 Ko) : l'app garde sa typo hors ligne.
      globPatterns: ['**/*.{js,css,png,svg,webmanifest,woff2}'],
      globIgnores: ['**/node_modules/**'],
    },
    client: { installPrompt: false, periodicSyncForUpdates: 0 },
    devOptions: { enabled: false },
  },

  nitro: {
    preset: 'node-server',
    experimental: { websocket: true },
    // Scripts donnés aux machines (installation de la barre d'état Claude) :
    // embarqués, le dépôt n'est pas dans l'image.
    serverAssets: [{ baseName: 'scripts', dir: '../scripts' }],
  },

  // Code de l'app toujours revalidé (sinon un iPhone garde l'ancienne version
  // après une mise à jour) ; seuls les fichiers à empreinte (/_nuxt/) et les
  // icônes se gardent.
  routeRules: {
    '/**': { headers: {
      'cache-control': 'no-cache',
      'content-security-policy': CSP_BASE,
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    } },
    '/icons/**': { headers: { 'cache-control': 'public, max-age=86400' } },
    '/_nuxt/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
  },

  // Jamais de rechargement automatique après un déploiement (Nuxt rechargerait
  // à la navigation suivante) : app/plugins/app-version.client.ts détecte le
  // nouveau build et affiche un bandeau « Recharger ».
  experimental: { emitRouteChunkError: 'manual', checkOutdatedBuildInterval: false },

  compatibilityDate: '2025-07-15',
})
