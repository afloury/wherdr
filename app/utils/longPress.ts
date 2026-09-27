// Appui long au doigt (téléphone) : `onPress` après `delay` ms si le doigt n'a
// pas bougé de plus de `slop` px (sinon c'est un défilement) ni quitté l'écran.
// Le toucher qui l'a déclenché ne compte pas comme un toucher simple :
// `swallowClick()` le dit au gestionnaire de clic. Pur (testé).
export interface LongPressOptions { delay?: number, slop?: number, onPress: () => void }
type Point = { pointerType: string, clientX: number, clientY: number }

export function longPress({ delay = 450, slop = 8, onPress }: LongPressOptions) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let x = 0
  let y = 0
  let firedAt = 0
  // iOS lance parfois « tout sélectionner » sur un appui long, même sur un
  // élément non sélectionnable : on bloque toute sélection pendant l'appui.
  const noSelect = (ev: Event) => ev.preventDefault()
  const doc = typeof document === 'undefined' ? null : document
  const release = () => {
    doc?.removeEventListener('selectstart', noSelect)
    setTimeout(() => doc?.removeEventListener('selectstart', noSelect), 0)
  }
  const cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
    release()
  }
  return {
    down(e: Point) {
      cancel()
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return
      x = e.clientX
      y = e.clientY
      doc?.addEventListener('selectstart', noSelect)
      timer = setTimeout(() => {
        timer = null
        firedAt = Date.now()
        doc?.getSelection?.()?.removeAllRanges()
        onPress()
        setTimeout(release, 800)
      }, delay)
    },
    move(e: Point) {
      if (timer && Math.hypot(e.clientX - x, e.clientY - y) > slop) cancel()
    },
    cancel,
    // Un glisser peut durer bien plus de 800 ms après l'appui long.
    // Repartir du relâchement pour ignorer le clic synthétique d'iOS.
    suppressClick: () => { firedAt = Date.now() },
    // Le clic qui suit l'appui long (doigt levé) : à ignorer.
    swallowClick: () => Date.now() - firedAt < 800,
  }
}
