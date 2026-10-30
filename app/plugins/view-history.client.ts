import { internalBack, isDetailRoute } from '~/utils/viewHistory'

export default defineNuxtPlugin((app) => {
  const router = useRouter()
  // Search is a sheet: returning restores the screen that hosted it.
  let home: { machine: string | null, scroll: number } | undefined
  router.beforeEach((to, from) => {
    if (!desk.value && from.path === '/' && to.path !== '/') {
      home = { machine: machineBarPick.value, scroll: document.querySelector('#home .scroll')?.scrollTop ?? 0 }
    }
  })
  router.afterEach(async (to) => {
    if (desk.value || to.path !== '/' || !home) return
    if (home.machine !== null) pickMachineBar(home.machine)
    await nextTick()
    document.querySelector('#home .scroll')?.scrollTo({ top: home.scroll })
  })
  app.hook('app:mounted', () => {
    const router = useRouter()
    const route = router.currentRoute.value
    if (desk.value || !isDetailRoute(route.path, route.query) || internalBack(history.state?.back)) return
    // A cold notification or direct link has no app screen behind it. Put Home
    // underneath the detail once, including on reload. Use RouterHistory so its
    // position/back/forward bookkeeping stays consistent with native iOS/Android
    // back gestures, without rendering an intermediate screen or adding a loop.
    router.options.history.replace('/')
    router.options.history.push(route.fullPath)
  })
})
