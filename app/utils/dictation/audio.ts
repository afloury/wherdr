import { TAKE_RATE } from './engine'

// Linear resample to 16 kHz mono, one capture buffer at a time. The capture
// context runs at the device's native rate (Firefox refuses to connect a mic
// source to a context of another rate), so every engine gets the same 16 kHz
// take whatever the device. The position carries over from buffer to buffer:
// no sample is lost or doubled at the joins. From followcat's resampleTo16k.
export function createResampler(srcRate: number): (src: Float32Array) => Float32Array {
  const ratio = srcRate / TAKE_RATE
  let pos = 0 // next output position, in samples of the coming buffer (>= -1)
  let prev = 0 // last sample of the previous buffer, at position -1
  return (src) => {
    if (ratio === 1) return src.slice(0)
    const n = Math.max(0, Math.ceil((src.length - 1 - pos) / ratio))
    const out = new Float32Array(n)
    for (let k = 0; k < n; k++) {
      const p = pos + k * ratio
      const a = Math.floor(p)
      const from = a < 0 ? prev : src[a]!
      out[k] = from + (src[a + 1]! - from) * (p - a)
    }
    if (src.length) {
      pos += n * ratio - src.length
      prev = src[src.length - 1]!
    }
    return out
  }
}

// Root mean square of a slice: one bar of the composer's live wave.
export function rms(pcm: Float32Array, from = 0, to = pcm.length): number {
  let sum = 0
  for (let i = from; i < to; i++) sum += pcm[i]! * pcm[i]!
  return to > from ? Math.sqrt(sum / (to - from)) : 0
}

export function concatPcm(chunks: Float32Array[], length: number): Float32Array {
  const out = new Float32Array(length)
  let at = 0
  for (const c of chunks) { out.set(c, at); at += c.length }
  return out
}
