import { directRoute } from '~/utils/directRoute'

export default defineNuxtPlugin(async () => {
  const target = directRoute(location.pathname, location.search, location.hash)
  if (!target) return
  history.replaceState(history.state, '', target)
  await useRouter().replace(target.slice(2))
})
