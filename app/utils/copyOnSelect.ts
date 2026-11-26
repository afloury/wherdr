// Copy on select: selecting text with the mouse copies it at once, like a
// terminal does. The decision is pure (testable); the listener lives in
// composables/useCopyOnSelect.ts.

// On by default with a mouse or trackpad (computer), off on a touch screen
// (phone, tablet), where a selection is a step towards the system's own Copy.
export function defaultCopyOnSelect(finePointer: boolean): boolean {
  return finePointer
}

const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'

// A field being typed in: the message field or any other input.
export function isEditableElement(el: Element | null | undefined): boolean {
  return !!el?.closest?.(EDITABLE)
}

export interface CopyOnSelectState {
  enabled: boolean
  text: string
  // The mouse was released on, or the focus sits in, an input, a textarea or a contenteditable.
  inEditable: boolean
}

// What to put in the clipboard, or null when nothing should be copied.
export function copyOnSelectText({ enabled, text, inEditable }: CopyOnSelectState): string | null {
  if (!enabled || inEditable) return null
  return text.trim() ? text : null
}
