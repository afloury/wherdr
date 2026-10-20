// The output of a command on an SSH machine is bounded while it arrives:
// past the limit nothing more is kept, and what was kept is let go.
import { describe, expect, it } from 'vitest'
import { boundedOutput } from '../server/utils/fsx'

describe('boundedOutput', () => {
  it('keeps everything up to the limit', () => {
    const o = boundedOutput(6)
    expect(o.push(Buffer.from('abc'))).toBe(true)
    expect(o.push(Buffer.from('def'))).toBe(true)
    expect(o.over).toBe(false)
    expect(o.take().toString()).toBe('abcdef')
  })

  it('past the limit: refuses more and holds nothing', () => {
    const o = boundedOutput(4)
    o.push(Buffer.from('abc'))
    expect(o.push(Buffer.from('de'))).toBe(false)
    expect(o.over).toBe(true)
    expect(o.take().length).toBe(0)
    expect(o.push(Buffer.from('f'))).toBe(false)
    expect(o.take().length).toBe(0)
  })

  it('no limit given: keeps all', () => {
    const o = boundedOutput()
    for (let i = 0; i < 100; i++) o.push(Buffer.alloc(1024))
    expect(o.take().length).toBe(102400)
  })
})
