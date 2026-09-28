// Service worker de wherdr : installable + notifications.
// Tout passe par le réseau d'abord (l'app n'a de sens que connectée au serveur) ;
// le cache ne sert qu'à afficher la coquille si le réseau est coupé.
// Jamais de cache pour /api/, /ws/ ni /uploads/.

/* eslint-disable @typescript-eslint/no-explicit-any */
interface SwGlobal {
  __WB_MANIFEST: Array<{ url: string, revision: string | null } | string>
  location: Location
  registration: {
    showNotification: (title: string, opts: Record<string, unknown>) => Promise<void>
  }
  clients: {
    claim: () => Promise<void>
    matchAll: (opts: Record<string, unknown>) => Promise<Array<{ url: string, postMessage: (m: unknown) => void, focus: () => Promise<unknown> }>>
    openWindow: (url: string) => Promise<unknown>
  }
  navigator: Navigator & { setAppBadge?: (n: number) => Promise<void> }
  skipWaiting: () => Promise<void>
  addEventListener: (type: string, fn: (e: any) => void) => void
}
const sw = self as unknown as SwGlobal

const CACHE = 'wherdr-v1'
// Fichiers de l'app construite (empreintes dans le nom) + la page.
// (écrit tel quel : workbox cherche « self.__WB_MANIFEST » pour y injecter la liste)
const WB_MANIFEST = self.__WB_MANIFEST
const PRECACHE = ['/', ...WB_MANIFEST.map(e => '/' + (typeof e === 'string' ? e : e.url).replace(/^\//, ''))]

sw.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE)
    // Un fichier manquant ne doit pas empêcher l'installation.
    await Promise.all(PRECACHE.map(u => c.add(new Request(u, { cache: 'no-cache' })).catch(() => {})))
    await sw.skipWaiting()
  })())
})

sw.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k)
    await sw.clients.claim()
  })())
})

sw.addEventListener('fetch', (e) => {
  const req: Request = e.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== sw.location.origin
    || url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/') || url.pathname.startsWith('/uploads/')) return
  e.respondWith((async () => {
    try {
      // no-cache : toujours revalider auprès du serveur, jamais servir une vieille
      // version depuis le cache HTTP du téléphone.
      const res = await fetch(req, { cache: 'no-cache' })
      if (res.ok) {
        const c = await caches.open(CACHE)
        c.put(req, res.clone())
      }
      return res
    } catch {
      return (await caches.match(req)) || (req.mode === 'navigate' ? (await caches.match('/')) || Response.error() : Response.error())
    }
  })())
})

sw.addEventListener('push', (e) => {
  let d: Record<string, any> = {}
  try { d = e.data ? e.data.json() : {} }
  catch { d = { body: e.data ? e.data.text() : '' } }
  e.waitUntil((async () => {
    await sw.registration.showNotification(d.title || 'wherdr', {
      body: d.body || '',
      tag: d.tag || 'herdr', // une notif par pane, remplacée à chaque changement
      renotify: true,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: d.url || '/' },
    })
    try {
      if (typeof d.badge === 'number' && sw.navigator.setAppBadge) await sw.navigator.setAppBadge(d.badge)
    } catch { /* non géré */ }
  })())
})

sw.addEventListener('notificationclick', (e) => {
  e.notification.close()
  e.waitUntil((async () => {
    let target = '/'
    try {
      const u = new URL((e.notification.data && e.notification.data.url) || '/', sw.location.origin)
      if (u.origin === sw.location.origin) target = u.pathname + u.search + u.hash
    } catch { /* adresse illisible */ }
    const wins = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of wins) {
      if (c.url.startsWith(sw.location.origin)) {
        c.postMessage({ type: 'navigate', url: target })
        return c.focus()
      }
    }
    return sw.clients.openWindow(target)
  })())
})

declare global {
  interface Window { __WB_MANIFEST: SwGlobal['__WB_MANIFEST'] }
}
export {}
