// A link to Tasks to review (utils/reviewLink.ts): the sheet opens, the page stays.
import { reviewRoute } from '~/utils/reviewLink'

export default defineNuxtRouteMiddleware((to, from) => {
  if (import.meta.server) return
  const r = reviewRoute(to.path, from.matched.length ? from.path : null)
  if (!r) return
  reviewOpen.value = true
  return r === 'stay' ? abortNavigation() : navigateTo(r, { replace: true })
})
