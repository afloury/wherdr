// wherdr.dev — static site (`nuxt generate`), served by Cloudflare Workers
// static assets (wrangler.jsonc) and, privately, by nginx (Dockerfile).
// Everything is bundled: fonts (@fontsource), icons, images. No request
// leaves the page: no web fonts service, no CDN, no analytics.
const title = 'wherdr — your Herdr coding agents, from your phone and your browser'
const description = 'wherdr is a self-hosted web app and PWA to follow and drive the coding agents (Claude Code, Codex, omp…) running in Herdr on your machines. Private network only, open source, MIT.'

export default defineNuxtConfig({
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  typescript: { strict: true },
  devtools: { enabled: false },
  telemetry: false,
  compatibilityDate: '2026-09-01',

  ui: {
    colorMode: false,
    fonts: false,
    theme: { colors: ['primary', 'neutral', 'success', 'warning', 'error', 'info'] },
  },

  icon: {
    provider: 'none',
    fallbackToApi: false,
    serverBundle: false,
    // Agent logos, copied from the app (app/assets/icons).
    customCollections: [{ prefix: 'herdr', dir: './app/assets/icons' }],
    clientBundle: {
      scan: true,
      icons: ['lucide:x', 'lucide:check', 'lucide:chevron-down', 'lucide:copy'],
    },
  },

  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      title,
      meta: [
        { name: 'description', content: description },
        { name: 'theme-color', content: '#12151b' },
        { name: 'color-scheme', content: 'dark' },
        { property: 'og:type', content: 'website' },
        { property: 'og:url', content: 'https://wherdr.dev/' },
        { property: 'og:title', content: title },
        { property: 'og:description', content: description },
        { property: 'og:image', content: 'https://wherdr.dev/og.png' },
        { name: 'twitter:card', content: 'summary_large_image' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/icon.svg' },
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32.png' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      ],
    },
  },

  nitro: {
    // One page; /install, /_headers and the images are plain files of public/.
    prerender: { routes: ['/'], crawlLinks: false },
  },
})
