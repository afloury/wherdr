// OSC 52: a program in the terminal puts text on the clipboard
// (`ESC ] 52 ; <selection> ; <base64> BEL`), the way copy works over SSH or
// tmux. Written to the browser's clipboard, so an agent's copy reaches the
// device in hand rather than the machine the agent runs on (issue #47).
// Write only: a read request (`?`) would hand the clipboard to the program,
// it is ignored. Over MAX bytes, the copy is ignored too.
import type { Terminal } from '@xterm/xterm'

export const OSC52_MAX_BYTES = 100_000

export type Osc52Request =
  | { kind: 'write', text: string }
  | { kind: 'read' }
  | { kind: 'too-large', bytes: number }
  | { kind: 'invalid' }

const SELECTION_RE = /^[cpqs0-7]*$/
const B64_RE = /^[A-Za-z0-9+/]*={0,2}$/

// Bytes the base64 payload decodes to, without decoding it.
export function base64DecodedSize(b64: string): number {
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.floor(b64.length * 3 / 4) - pad
}

// `data`: what follows `52;` in the sequence, as xterm hands it to the handler.
export function parseOsc52(data: string, maxBytes = OSC52_MAX_BYTES): Osc52Request {
  const sep = data.indexOf(';')
  if (sep < 0) return { kind: 'invalid' }
  if (!SELECTION_RE.test(data.slice(0, sep))) return { kind: 'invalid' }
  const payload = data.slice(sep + 1).replace(/\s+/g, '')
  if (payload === '?') return { kind: 'read' }
  // Empty payload: "clear the clipboard", nothing to write.
  if (!payload || payload.length % 4 === 1 || !B64_RE.test(payload)) return { kind: 'invalid' }
  const bytes = base64DecodedSize(payload)
  if (bytes > maxBytes) return { kind: 'too-large', bytes }
  let bin: string
  try { bin = atob(payload) }
  catch { return { kind: 'invalid' } }
  const text = new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)))
  return text ? { kind: 'write', text } : { kind: 'invalid' }
}

type Clipboard = Pick<globalThis.Clipboard, 'writeText'>

// Writes the agent's text. `refused`: the browser said no (iOS Safari without
// a user gesture, an unfocused page…), the text is offered to copy on a tap.
export async function copyAgentText(text: string, clipboard: Clipboard | undefined, d: {
  copied: () => void
  refused: (text: string) => void
}): Promise<boolean> {
  try {
    if (!clipboard) throw new Error('no clipboard')
    await clipboard.writeText(text)
    d.copied()
    return true
  } catch {
    d.refused(text)
    return false
  }
}

// Handles OSC 52 in `term`. The sequence is always consumed (true), even when
// ignored, so it never reaches another handler.
export function bindTerminalOsc52(term: Pick<Terminal, 'parser'>, d: {
  enabled: () => boolean
  write: (text: string) => void
  tooLarge: (bytes: number) => void
  maxBytes?: number
}): () => void {
  const handler = term.parser.registerOscHandler(52, (data) => {
    if (!d.enabled()) return true
    const req = parseOsc52(data, d.maxBytes)
    if (req.kind === 'write') d.write(req.text)
    else if (req.kind === 'too-large') d.tooLarge(req.bytes)
    return true
  })
  return () => handler.dispose()
}
