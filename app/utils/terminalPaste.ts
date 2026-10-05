// Image pasted into a terminal (a browser paste: ⌘V on a Mac; xterm hands
// Ctrl+V to the program as ^V). xterm only pastes the clipboard's text, and a
// screenshot or a copied image has none: nothing reached the program. The
// agent's own image paste (Ctrl+V in omp or Claude Code) reads the clipboard of
// the machine it runs on, not the browser's. So the images take the photo path,
// as in the message field (shrunk, copied to the agent's machine), and their
// paths are pasted: omp and Claude Code turn a pasted image path into an image.
// A clipboard with text stays a text paste: Office and Numbers put a picture
// of the cells next to their text.
import { t } from './i18n'

type ClipboardContent = Pick<DataTransfer, 'getData' | 'items'>

function pastedImages(data: ClipboardContent | null): File[] {
  if (!data || data.getData('text/plain')) return []
  return [...(data.items || [])]
    .filter(i => i.kind === 'file' && i.type.startsWith('image/'))
    .map(i => i.getAsFile())
    .filter((f): f is File => Boolean(f))
}

// `host`: an ancestor of xterm's textarea. Listened in the capture phase, so
// xterm, whose listeners sit on the textarea and its own element, never sees an
// image paste. `upload` returns the image's path on the agent's machine (one
// image at a time, as the message field does). `paste` hands the paths that
// uploaded to the program as one paste, in clipboard order, separated by
// spaces (a line break would run a plain shell's command); it goes through
// Herdr's pane input, which omp receives as a paste and turns into an image (the
// same path typed through this xterm stays text: it only draws Herdr's frames
// and never learns the program's bracketed paste mode). false: not connected.
// `report` shows what failed. `enabled` false: the paste is left to xterm.
export function bindTerminalImagePaste(host: HTMLElement, d: {
  upload: (f: File) => Promise<string>
  paste: (text: string) => boolean
  report: (message: string) => void
  enabled?: () => boolean
}): () => void {
  async function pasteImages(images: File[]) {
    const paths: string[] = []
    for (const f of images) {
      try { paths.push(await d.upload(f)) }
      catch (err) { d.report(`${t('Photo upload failed')} : ${(err as Error).message}`) }
    }
    if (paths.length && !d.paste(paths.join(' '))) d.report(t('Terminal not connected — image not pasted'))
  }
  const onPaste = (e: ClipboardEvent) => {
    const images = pastedImages(e.clipboardData)
    if (!images.length || (d.enabled && !d.enabled())) return
    e.preventDefault()
    e.stopPropagation()
    pasteImages(images)
  }
  host.addEventListener('paste', onPaste, true)
  return () => host.removeEventListener('paste', onPaste, true)
}
