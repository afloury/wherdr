import { describe, expect, it } from 'vitest'
import { gunzipSync } from 'node:zlib'
import { GZIP_MIN, gzipBody } from '../server/utils/gzipJson'

describe('large JSON answers, gzipped', () => {
  const big = { items: Array.from({ length: 400 }, (_, i) => ({ role: 'assistant', text: `reply ${i}` })) }
  it('gzips a large object for a browser that takes it, and it reads back the same', () => {
    const body = gzipBody('gzip, deflate, br', big)
    expect(body).not.toBeNull()
    expect(body!.length).toBeLessThan(JSON.stringify(big).length / 4)
    expect(JSON.parse(gunzipSync(body!).toString('utf8'))).toEqual(big)
  })
  it('leaves small answers, other encodings and anything but plain JSON as they are', () => {
    expect(gzipBody('gzip', { ok: true })).toBeNull()
    expect(gzipBody('br', big)).toBeNull()
    expect(gzipBody(undefined, big)).toBeNull()
    expect(gzipBody('gzip', Buffer.alloc(GZIP_MIN * 2))).toBeNull()
    expect(gzipBody('gzip', 'x'.repeat(GZIP_MIN * 2))).toBeNull()
    expect(gzipBody('gzip', new Map([['a', 1]]))).toBeNull()
    expect(gzipBody('gzip', Array.from({ length: 2000 }, (_, i) => i))).not.toBeNull()
  })
})
