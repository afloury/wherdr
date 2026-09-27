// Thème appliqué avant le premier rendu (pas de flash du thème par défaut).
export default defineNuxtPlugin(() => {
  installTheme()
  // iOS n'applique :active aux boutons que si la page écoute touchstart :
  // l'état appuyé des boutons principaux (fond d'accent) en dépend.
  document.addEventListener('touchstart', () => {}, { passive: true })
})
