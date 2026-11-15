import { TAKE_RATE } from './engine'

// A take as a 16 kHz, 16-bit mono WAV (32 kB a second): what the OpenRouter
// relay sends on. Samples outside [-1, 1] are clipped.
export function encodeWav(pcm: Float32Array, rate = TAKE_RATE): ArrayBuffer {
  const buf = new ArrayBuffer(44 + pcm.length * 2)
  const v = new DataView(buf)
  const str = (at: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE')
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, pcm.length * 2, true)
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]!))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
  }
  return buf
}
