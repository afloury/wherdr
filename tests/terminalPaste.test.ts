// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { bindTerminalImagePaste } from '../app/utils/terminalPaste'

// The terminal as xterm builds it: its textarea inside the host, with xterm's
// own paste listener on it (xterm pastes the clipboard's text, nothing else).
function terminal() {
  const host = document.createElement('div')
  const textarea = document.createElement('textarea')
  host.appendChild(textarea)
  document.body.appendChild(host)
  const xtermPaste = vi.fn()
  textarea.addEventListener('paste', xtermPaste)
  return { host, textarea, xtermPaste }
}

function paste(target: HTMLElement, content: { text?: string, files?: File[] }) {
  const data = new DataTransfer()
  if (content.text !== undefined) data.setData('text/plain', content.text)
  for (const f of content.files || []) data.items.add(f)
  const e = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
  target.dispatchEvent(e)
  return e
}

const file = (name: string, type: string) => new File([new Uint8Array([1, 2, 3])], name, { type })
const uploads = '/home/me/.cache/herdr-web/uploads'

describe('image pasted into the terminal', () => {
  it('uploads the image and pastes its path for the agent, instead of xterm’s empty paste', async () => {
    const { host, textarea, xtermPaste } = terminal()
    const upload = vi.fn(async () => `${uploads}/a.jpg`)
    const pasted = vi.fn(() => true)
    bindTerminalImagePaste(host, { upload, paste: pasted, report: vi.fn() })
    const shot = file('shot.png', 'image/png')

    const e = paste(textarea, { files: [shot] })

    expect(e.defaultPrevented).toBe(true)
    expect(xtermPaste).not.toHaveBeenCalled()
    expect(upload).toHaveBeenCalledWith(shot)
    await vi.waitFor(() => expect(pasted).toHaveBeenCalledWith(`${uploads}/a.jpg`))
  })

  it('pastes several images as one paste, in clipboard order', async () => {
    const { host, textarea } = terminal()
    const pasted = vi.fn(() => true)
    bindTerminalImagePaste(host, { upload: async f => `${uploads}/${f.name}`, paste: pasted, report: vi.fn() })

    paste(textarea, { files: [file('a.png', 'image/png'), file('b.png', 'image/png')] })

    await vi.waitFor(() => expect(pasted).toHaveBeenCalledTimes(1))
    expect(pasted).toHaveBeenCalledWith(`${uploads}/a.png ${uploads}/b.png`)
  })

  it('leaves text and non-image files to xterm, even with a rendered image beside the text', () => {
    const { host, textarea, xtermPaste } = terminal()
    const upload = vi.fn(async () => `${uploads}/x.jpg`)
    bindTerminalImagePaste(host, { upload, paste: vi.fn(() => true), report: vi.fn() })

    // Office and Numbers put a picture of the cells next to their text.
    const cells = paste(textarea, { text: 'a\tb', files: [file('cells.png', 'image/png')] })
    const pdf = paste(textarea, { files: [file('doc.pdf', 'application/pdf')] })

    expect(upload).not.toHaveBeenCalled()
    expect(cells.defaultPrevented).toBe(false)
    expect(pdf.defaultPrevented).toBe(false)
    expect(xtermPaste).toHaveBeenCalledTimes(2)
  })

  it('reports a failed upload and pastes nothing', async () => {
    const { host, textarea } = terminal()
    const pasted = vi.fn(() => true)
    const report = vi.fn()
    bindTerminalImagePaste(host, { upload: async () => { throw new Error('Image too large (20 MB max)') }, paste: pasted, report })

    paste(textarea, { files: [file('big.png', 'image/png')] })

    await vi.waitFor(() => expect(report).toHaveBeenCalledWith('Photo upload failed : Image too large (20 MB max)'))
    expect(pasted).not.toHaveBeenCalled()
  })

  it('pastes the images that uploaded and reports the others', async () => {
    const { host, textarea } = terminal()
    const pasted = vi.fn(() => true)
    const report = vi.fn()
    const upload = async (f: File) => {
      if (f.name === 'a.png') throw new Error('Unsupported image type')
      return `${uploads}/${f.name}`
    }
    bindTerminalImagePaste(host, { upload, paste: pasted, report })

    paste(textarea, { files: [file('a.png', 'image/png'), file('b.png', 'image/png')] })

    await vi.waitFor(() => expect(pasted).toHaveBeenCalledWith(`${uploads}/b.png`))
    expect(report).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith('Photo upload failed : Unsupported image type')
  })

  it('says so when the terminal is no longer connected to paste the path', async () => {
    const { host, textarea } = terminal()
    const report = vi.fn()
    bindTerminalImagePaste(host, { upload: async () => `${uploads}/a.jpg`, paste: () => false, report })

    paste(textarea, { files: [file('shot.png', 'image/png')] })

    await vi.waitFor(() => expect(report).toHaveBeenCalledWith('Terminal not connected — image not pasted'))
  })

  it('leaves the paste to xterm while the terminal takes no input, and takes it once it does', async () => {
    const { host, textarea, xtermPaste } = terminal()
    let interactive = false
    const upload = vi.fn(async () => `${uploads}/a.jpg`)
    const pasted = vi.fn(() => true)
    bindTerminalImagePaste(host, { upload, paste: pasted, report: vi.fn(), enabled: () => interactive })

    const idle = paste(textarea, { files: [file('shot.png', 'image/png')] })
    expect(idle.defaultPrevented).toBe(false)
    expect(xtermPaste).toHaveBeenCalledTimes(1)
    expect(upload).not.toHaveBeenCalled()

    interactive = true
    paste(textarea, { files: [file('shot.png', 'image/png')] })
    await vi.waitFor(() => expect(pasted).toHaveBeenCalledWith(`${uploads}/a.jpg`))
    expect(xtermPaste).toHaveBeenCalledTimes(1)
  })
})
