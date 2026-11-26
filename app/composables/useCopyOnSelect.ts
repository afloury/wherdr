// Settings › Conversation › Display › Copy on select. Kept per user: unset, it follows the
// device (on with a mouse, off on a phone). The conversation's selections are
// copied here, on mouse release; the terminal's in utils/terminalSelection.ts.
import { copyOnSelectText, defaultCopyOnSelect, isEditableElement } from '~/utils/copyOnSelect'
import { flag, syncedRef } from './useSyncedSettings'

export const finePointer = () => typeof matchMedia !== 'undefined' && matchMedia('(hover: hover) and (pointer: fine)').matches

export const copyOnSelect = syncedRef('copyOnSelect', (raw: string | null) => flag.read(defaultCopyOnSelect(finePointer()))(raw), flag.write)

// Listens on the window: a mouse release that ends a selection in the page's
// text copies it. The terminal (xterm keeps its own selection) is left to its
// own binding.
export function bindCopyOnSelect(copied: () => void, enabled: () => boolean = () => copyOnSelect.value): () => void {
  const onUp = (e: MouseEvent) => {
    if (e.button !== 0 || !enabled()) return
    const target = e.target instanceof Element ? e.target : null
    if (target?.closest('.xterm')) return
    const text = copyOnSelectText({
      enabled: true,
      text: window.getSelection()?.toString() ?? '',
      inEditable: isEditableElement(target) || isEditableElement(document.activeElement) || isEditableElement(window.getSelection()?.anchorNode?.parentElement),
    })
    if (!text || !navigator.clipboard?.writeText) return
    navigator.clipboard.writeText(text).then(copied, () => { /* refused: the selection stays, Copy still works */ })
  }
  window.addEventListener('mouseup', onUp, true)
  return () => window.removeEventListener('mouseup', onUp, true)
}
