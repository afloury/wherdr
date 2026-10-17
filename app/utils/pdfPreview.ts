// Bound each bitmap to 16 MiB (RGBA), including unusually tall pages on Retina.
export function pdfOutputScale(width: number, height: number, dpr: number) {
  return Math.min(Math.max(1, dpr), Math.sqrt(4_194_304 / (width * height)))
}
