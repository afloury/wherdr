// wherdr.dev — static site (`nuxt generate`), served by Cloudflare Workers
// static assets (wrangler.jsonc) and, privately, by nginx (Dockerfile).
// Everything is bundled: fonts (@fontsource), icons, images. No request
// leaves the page: no web fonts service, no CDN, no analytics.
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DESCRIPTION as description, SHARE_IMAGE, SITEMAP_PAGES, TITLE as title, sitemapXml } from './app/utils/seo'

// Date of the last commit that touched one of `sources` (paths inside website/).
// Without Git history (the Docker build context), the build date.
function lastModified(cwd: string, sources: readonly string[]): string {
  try {
    const date = execFileSync('git', ['log', '-1', '--format=%cI', '--', ...sources], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    if (date) return date
  }
  catch { /* no git, or not a repository */ }
  return new Date().toISOString()
}

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
      icons: ['lucide:x', 'lucide:check', 'lucide:chevron-down', 'lucide:copy', 'lucide:file-text', 'lucide:file-plus', 'lucide:terminal'],
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
        // Link previews. The canonical address, og:url and the structured data
        // belong to the home page alone: components/HomePage.vue.
        { property: 'og:type', content: 'website' },
        { property: 'og:site_name', content: 'wherdr' },
        { property: 'og:locale', content: 'en_US' },
        { property: 'og:title', content: title },
        { property: 'og:description', content: description },
        { property: 'og:image', content: SHARE_IMAGE.url },
        { property: 'og:image:type', content: 'image/png' },
        { property: 'og:image:width', content: String(SHARE_IMAGE.width) },
        { property: 'og:image:height', content: String(SHARE_IMAGE.height) },
        { property: 'og:image:alt', content: SHARE_IMAGE.alt },
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:title', content: title },
        { name: 'twitter:description', content: description },
        { name: 'twitter:image', content: SHARE_IMAGE.url },
        { name: 'twitter:image:alt', content: SHARE_IMAGE.alt },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/icon.svg' },
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32.png' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      ],
    },
  },

  nitro: {
    // One page; /install, /robots.txt, /_headers and the images are plain files of public/.
    prerender: { routes: ['/'], crawlLinks: false },
  },

  hooks: {
    // sitemap.xml, written next to the copied public/ files, each page dated
    // by the last commit of its sources.
    'nitro:build:public-assets': (nitro) => {
      const entries = SITEMAP_PAGES.map(page => ({ path: page.path, lastmod: lastModified(nitro.options.rootDir, page.sources) }))
      writeFileSync(join(nitro.options.output.publicDir, 'sitemap.xml'), sitemapXml(entries))
    },
  },
})
