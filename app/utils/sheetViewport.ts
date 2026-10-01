// Visible area for bottom sheets on the phone. iOS keeps fixed elements on the
// layout viewport: with the keyboard open (or a page left scrolled after it
// closes), `bottom: 0` falls under the keyboard or leaves a dark band of
// scrim. Sheets sit on the visual viewport instead: `bottom` is the part of the
// layout viewport hidden below it, `height` the visible height.
export function sheetViewport(innerHeight: number, vvTop: number, vvHeight: number) {
  const height = Math.max(0, Math.round(vvHeight || innerHeight))
  const bottom = Math.max(0, Math.round(innerHeight - (vvTop || 0) - height))
  return { height, bottom }
}
