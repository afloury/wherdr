// Visible area for bottom sheets on the phone. iOS keeps fixed elements on the
// layout viewport: with the keyboard open (or a page left scrolled after it
// closes), `bottom: 0` falls under the keyboard or leaves a dark band of
// scrim. Sheets sit on the visual viewport instead: `bottom` is the part of the
// layout viewport hidden below it, `top` the part scrolled above it, `height`
// the visible height.
export function sheetViewport(innerHeight: number, vvTop: number, vvHeight: number) {
  const height = Math.max(0, Math.round(vvHeight || innerHeight))
  const top = Math.max(0, Math.round(vvTop || 0))
  const bottom = Math.max(0, Math.round(innerHeight - top - height))
  return { height, top, bottom }
}
