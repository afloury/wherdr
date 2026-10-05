// v-reveal: fades an element in the first time it enters the viewport.
// Added on the client only, so the prerendered HTML stays fully visible
// without JavaScript; prefers-reduced-motion skips it (see main.css).
export default defineNuxtPlugin((nuxt) => {
  let io: IntersectionObserver | undefined
  const observer = () => io ??= new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue
      e.target.classList.add('in')
      io?.unobserve(e.target)
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 })

  nuxt.vueApp.directive<HTMLElement>('reveal', {
    getSSRProps: () => ({}),
    mounted(el) {
      if (!('IntersectionObserver' in window)) return
      const r = el.getBoundingClientRect()
      if (r.top < window.innerHeight) return // already on screen: no flash
      el.classList.add('reveal')
      observer().observe(el)
    },
    unmounted(el) { io?.unobserve(el) },
  })
})
