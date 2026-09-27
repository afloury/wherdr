// Dimensions sur iPhone : clavier, barre d'accueil, page raccourcie (iOS 26).

// Clavier ouvert : hauteur et position de la zone visible au-dessus.
export const kbOpen = ref(false)
export const vvHeight = ref(0)
export const vvTop = ref(0)
// Incrémenté à chaque changement de dimensions (le terminal se recale dessus).
export const layoutTick = ref(0)

const fullH = { orient: '', h: 0 }

export function layout() {
  const vv = window.visualViewport
  const h = vv ? vv.height : window.innerHeight
  const top = vv ? vv.offsetTop : 0
  // Clavier ouvert = la zone visible a perdu plus de 120 px par rapport à la
  // plus grande hauteur vue dans cette orientation. (Comparer à innerHeight ne
  // marche pas : avec interactive-widget=resizes-content, iOS rétrécit les deux.)
  const orient = screen.width > screen.height || innerWidth > innerHeight ? 'l' : 'p'
  if (orient !== fullH.orient) {
    fullH.orient = orient
    fullH.h = 0
  }
  fullH.h = Math.max(fullH.h, h, window.innerHeight)
  const kb = fullH.h - h > 120
  kbOpen.value = kb
  vvHeight.value = h
  vvTop.value = top
  document.body.classList.toggle('kb', kb)
  layoutTick.value++
}

// App installée dont la page s'arrête au-dessus du bas de l'écran (iOS 26 avec
// une barre d'état translucide, ou icône installée avant le changement) : la
// zone de sécurité du bas tomberait dans le vide.
// Signature du bug : page sous la barre d'état (zone de sécurité du haut non
// nulle) ET plus courte que l'écran d'autant. Avec une barre d'état opaque, la
// page commence sous l'heure (zone du haut nulle) et touche bien le bas.
export function checkShortBottom() {
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;padding-top:env(safe-area-inset-top);visibility:hidden'
  document.body.append(probe)
  const safeTop = parseFloat(getComputedStyle(probe).paddingTop) || 0
  probe.remove()
  const portrait = screen.height > screen.width
  const kb = window.visualViewport && innerHeight - window.visualViewport.height > 120
  const missing = screen.height - innerHeight
  document.body.classList.toggle('short-bottom',
    standalone && portrait && !kb && safeTop > 20 && missing >= safeTop - 4)
}

let installed = false
export function installViewport() {
  if (installed) return
  installed = true
  checkShortBottom()
  layout()
  window.addEventListener('resize', checkShortBottom)
  window.addEventListener('resize', layout)
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', layout)
    window.visualViewport.addEventListener('scroll', layout)
  }
}
