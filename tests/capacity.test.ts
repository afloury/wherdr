import { describe, expect, it } from 'vitest'
import { parseCapacity } from '../shared/pm/capacity'
import { DEFAULT_MEMORY, memoryLine } from '../shared/pm/memory'

// CAPACITY_SCRIPT's output on each OS (trimmed real samples).
const linux = `cores: 8
loadavg: 2.13 1.80 1.52 3/1234 56789
MemTotal:       32768000 kB
MemFree:         1024000 kB
MemAvailable:    9318400 kB
SwapTotal:       2097152 kB
SwapFree:        2031616 kB`

const macos = `cores: 10
memsize: 17179869184
loadavg: { 3.42 2.97 2.71 }
pressure: 1
Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               65536.
Pages active:                            300000.
Pages inactive:                          131072.
Pages speculative:                        32768.
Pages throttled:                              0.
Pages wired down:                        150000.
Pages purgeable:                          32768.`

describe('machine capacity', () => {
  it('reads Linux', () => {
    expect(parseCapacity(linux)).toEqual({ cores: 8, load1: 2.13, total: 32000, available: 9100, swapTotal: 2048, swapFree: 1984 })
  })

  it('reads macOS: available is free + inactive + speculative + purgeable pages', () => {
    // (65536 + 131072 + 32768 + 32768) × 16 KB = 4096 MB.
    expect(parseCapacity(macos)).toEqual({ cores: 10, load1: 3.42, total: 16384, available: 4096, swapTotal: 0, swapFree: 0, pressure: 'normal' })
    expect(memoryLine(parseCapacity(macos), DEFAULT_MEMORY, 1)).toBe('4.0 GB free of 16.0 GB · 10 cores, load 3.4 · pressure normal · 1 of 10 agents · go')
  })

  it('reads the macOS pressure level: 2 warn, 4 critical, unset when unreadable', () => {
    const at = (level: string) => parseCapacity(macos.replace('pressure: 1', `pressure: ${level}`))?.pressure
    expect([at('2'), at('4'), at('')]).toEqual(['warn', 'critical', undefined])
  })

  it('is unknown when the memory cannot be read', () => {
    expect(parseCapacity('')).toBeNull()
    expect(parseCapacity('cores: 4\nMach Virtual Memory Statistics: (page size of 4096 bytes)')).toBeNull()
    expect(memoryLine(null, DEFAULT_MEMORY, 0)).toBe('memory unknown · 0 agents · go')
  })
})
