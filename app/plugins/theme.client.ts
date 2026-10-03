// Theme applied before the first render (no flash of the default theme).
export default defineNuxtPlugin(() => {
  installTheme()
  // iOS only applies :active to buttons if the page listens to touchstart:
  // the pressed state of the main buttons (accent background) depends on it.
  document.addEventListener('touchstart', () => {}, { passive: true })
})
