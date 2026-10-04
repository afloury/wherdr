// Image viewer geometry, pure. The image is laid out at `scale` (1 = actual size,
// in CSS pixels) with its top-left corner at (x, y) inside the viewer box.

export interface ImageSize { w: number, h: number }
export interface ZoomView { scale: number, x: number, y: number }

// Step of the zoom buttons and +/- keys.
export const ZOOM_STEP = 1.5

// Whole image visible, never enlarged past its actual size.
export function fitScale(img: ImageSize, box: ImageSize): number {
  if (img.w <= 0 || img.h <= 0 || box.w <= 0 || box.h <= 0) return 1
  return Math.min(1, box.w / img.w, box.h / img.h)
}

// Scale reached by a double tap or a click on the image: the width of the
// box (capped at actual size), so a tall capture can be read by scrolling; at
// least twice the fit, so a small image does grow.
export function detailScale(img: ImageSize, box: ImageSize): number {
  const fit = fitScale(img, box)
  if (img.w <= 0 || box.w <= 0) return fit
  return Math.max(Math.min(1, box.w / img.w), fit * 2)
}

export function zoomBounds(img: ImageSize, box: ImageSize): { min: number, max: number } {
  const fit = fitScale(img, box)
  return { min: fit, max: Math.max(1, fit * 8, detailScale(img, box) * 2) }
}

// One axis: centred when the image is shorter than the box, otherwise no gap at either edge.
function clampAxis(pos: number, size: number, box: number): number {
  if (size <= box) return (box - size) / 2
  return Math.min(0, Math.max(box - size, pos))
}

// Scale within the bounds, position within the box.
export function clampView(v: ZoomView, img: ImageSize, box: ImageSize): ZoomView {
  const { min, max } = zoomBounds(img, box)
  const scale = Math.min(max, Math.max(min, v.scale))
  return { scale, x: clampAxis(v.x, img.w * scale, box.w), y: clampAxis(v.y, img.h * scale, box.h) }
}

export function fitView(img: ImageSize, box: ImageSize): ZoomView {
  return clampView({ scale: fitScale(img, box), x: 0, y: 0 }, img, box)
}

// New scale keeping the image point under (px, py) — box coordinates — where it is.
export function zoomAt(v: ZoomView, scale: number, px: number, py: number, img: ImageSize, box: ImageSize): ZoomView {
  const { min, max } = zoomBounds(img, box)
  const s = Math.min(max, Math.max(min, scale))
  const k = v.scale > 0 ? s / v.scale : 1
  return clampView({ scale: s, x: px - (px - v.x) * k, y: py - (py - v.y) * k }, img, box)
}

// The image is larger than its fit (with a margin for rounding).
export function isZoomed(v: ZoomView, img: ImageSize, box: ImageSize): boolean {
  return v.scale > fitScale(img, box) * 1.001
}

// Image larger than the box on at least one axis: a drag pans it.
export function canPan(v: ZoomView, img: ImageSize, box: ImageSize): boolean {
  return img.w * v.scale > box.w + 0.5 || img.h * v.scale > box.h + 0.5
}

// Double tap / click: back to the fit when zoomed, otherwise the detail scale at that point.
export function toggleZoom(v: ZoomView, px: number, py: number, img: ImageSize, box: ImageSize): ZoomView {
  if (isZoomed(v, img, box)) return fitView(img, box)
  return zoomAt(v, detailScale(img, box), px, py, img, box)
}

// Wheel delta in pixels to a zoom factor (trackpad pinch = ctrl+wheel, small deltas).
export function wheelFactor(deltaY: number, deltaMode: number): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY
  return Math.exp(-Math.max(-300, Math.min(300, px)) * 0.002)
}
