// An address change that arrives while the app starts (Back pressed during
// loading, a hash set right after the page load) must win. Two things put the
// address back: Vue Router ends its first navigation by writing the address
// it started on, and Nuxt's router plugin applies that route again once the
// app is created, cancelling a navigation that is still loading its page.
// Listen from the first script on, before the router exists, and apply the
// last address asked for once Nuxt is done.
let wanted: string | null = null
const note = () => { wanted = location.hash.replace(/^#/, '') || '/' }
window.addEventListener('hashchange', note)

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hooks.hookOnce('app:created', async () => {
    window.removeEventListener('hashchange', note)
    if (wanted === null) return
    const router = useRouter()
    const to = router.resolve(wanted)
    if (to.fullPath !== router.currentRoute.value.fullPath) await router.replace(to)
  })
})
