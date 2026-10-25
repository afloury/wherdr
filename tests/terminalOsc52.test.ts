// OSC 52 in the terminal (issue #47): an agent's copy reaches the browser's
// clipboard. Write only, size-capped, offered on a tap when the browser refuses.
import { describe, expect, it, vi } from 'vitest'
import { OSC52_MAX_BYTES, base64DecodedSize, bindTerminalOsc52, copyAgentText, parseOsc52 } from '../app/utils/terminalOsc52'

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64')

describe('parseOsc52', () => {
  it('decodes the base64 payload as UTF-8', () => {
    expect(parseOsc52(`c;${b64('hello world')}`)).toEqual({ kind: 'write', text: 'hello world' })
    expect(parseOsc52(`c;${b64('déjà vu — ✓\nline 2')}`)).toEqual({ kind: 'write', text: 'déjà vu — ✓\nline 2' })
  })

  it('accepts any selection, an empty one included', () => {
    expect(parseOsc52(`;${b64('a')}`)).toEqual({ kind: 'write', text: 'a' })
    expect(parseOsc52(`pc;${b64('ab')}`)).toEqual({ kind: 'write', text: 'ab' })
    expect(parseOsc52(`s0;${b64('abc')}`)).toEqual({ kind: 'write', text: 'abc' })
  })

  it('reports a read request, never a write', () => {
    expect(parseOsc52('c;?')).toEqual({ kind: 'read' })
    expect(parseOsc52(';?')).toEqual({ kind: 'read' })
  })

  it('rejects malformed sequences and empty payloads', () => {
    expect(parseOsc52('c')).toEqual({ kind: 'invalid' })
    expect(parseOsc52('c;')).toEqual({ kind: 'invalid' })
    expect(parseOsc52('c;not base64!')).toEqual({ kind: 'invalid' })
    expect(parseOsc52('c;abcde')).toEqual({ kind: 'invalid' })
    expect(parseOsc52(`x;${b64('a')}`)).toEqual({ kind: 'invalid' })
  })

  it('ignores a copy over the limit without decoding it', () => {
    const big = 'x'.repeat(OSC52_MAX_BYTES + 1)
    expect(parseOsc52(`c;${b64(big)}`)).toEqual({ kind: 'too-large', bytes: OSC52_MAX_BYTES + 1 })
    expect(parseOsc52(`c;${b64('x'.repeat(OSC52_MAX_BYTES))}`)).toMatchObject({ kind: 'write' })
    expect(parseOsc52(`c;${b64('abcdef')}`, 5)).toEqual({ kind: 'too-large', bytes: 6 })
  })

  it('computes the decoded size from the padding', () => {
    for (const s of ['', 'a', 'ab', 'abc', 'abcd', 'é']) expect(base64DecodedSize(b64(s))).toBe(Buffer.byteLength(s))
  })
})

describe('copyAgentText', () => {
  it('writes the text to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const copied = vi.fn()
    const refused = vi.fn()
    expect(await copyAgentText('hi', { writeText }, { copied, refused })).toBe(true)
    expect(writeText).toHaveBeenCalledWith('hi')
    expect(copied).toHaveBeenCalled()
    expect(refused).not.toHaveBeenCalled()
  })

  it('hands the text back when the browser refuses (no user gesture)', async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'))
    const copied = vi.fn()
    const refused = vi.fn()
    expect(await copyAgentText('hi', { writeText }, { copied, refused })).toBe(false)
    expect(refused).toHaveBeenCalledWith('hi')
    expect(copied).not.toHaveBeenCalled()
  })

  it('hands the text back without a clipboard API (plain http)', async () => {
    const refused = vi.fn()
    expect(await copyAgentText('hi', undefined, { copied: vi.fn(), refused })).toBe(false)
    expect(refused).toHaveBeenCalledWith('hi')
  })
})

describe('bindTerminalOsc52', () => {
  function bind(enabled = true) {
    let handler: (data: string) => boolean = () => false
    const dispose = vi.fn()
    const term = { parser: { registerOscHandler: vi.fn((id: number, h: typeof handler) => { expect(id).toBe(52); handler = h; return { dispose } }) } }
    const write = vi.fn()
    const tooLarge = vi.fn()
    const unbind = bindTerminalOsc52(term as never, { enabled: () => enabled, write, tooLarge, maxBytes: 10 })
    return { osc: (data: string) => handler(data), write, tooLarge, unbind, dispose }
  }

  it('writes a copy and consumes the sequence', () => {
    const b = bind()
    expect(b.osc(`c;${b64('copied')}`)).toBe(true)
    expect(b.write).toHaveBeenCalledWith('copied')
  })

  it('ignores read requests', () => {
    const b = bind()
    expect(b.osc('c;?')).toBe(true)
    expect(b.write).not.toHaveBeenCalled()
    expect(b.tooLarge).not.toHaveBeenCalled()
  })

  it('signals a copy over the limit instead of writing it', () => {
    const b = bind()
    b.osc(`c;${b64('01234567890')}`)
    expect(b.write).not.toHaveBeenCalled()
    expect(b.tooLarge).toHaveBeenCalledWith(11)
  })

  it('does nothing when turned off in Settings', () => {
    const b = bind(false)
    expect(b.osc(`c;${b64('copied')}`)).toBe(true)
    expect(b.write).not.toHaveBeenCalled()
  })

  it('removes the handler on unbind', () => {
    const b = bind()
    b.unbind()
    expect(b.dispose).toHaveBeenCalled()
  })
})
