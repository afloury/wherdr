import { describe, expect, it } from 'vitest'
import { parseMeters, parseOmpContext } from '../app/utils/meters'

describe('omp context meter', () => {
  it('reads the context percentage and window, estimating tokens from the displayed percentage', () => {
    expect(parseOmpContext('quota ◫ 51.7%/1M other')).toEqual({ pct: 51.7, total: 1_000_000, estimated: 517_000 })
    expect(parseOmpContext('◫ 0%/128K')).toEqual({ pct: 0, total: 128_000, estimated: 0 })
    expect(parseOmpContext('◫ 100%/1.5m')).toEqual({ pct: 100, total: 1_500_000, estimated: 1_500_000 })
  })
  it('reads current bordered gauges, but does not infer missing percent or window labels', () => {
    expect(parseOmpContext('▶──27%────┃──500K─◀')).toEqual({ pct: 27, total: 500_000, estimated: 135_000 })
    expect(parseOmpContext('▶─0.5%────┆──1M─◀')).toEqual({ pct: 0.5, total: 1_000_000, estimated: 5_000 })
    for (const text of ['▶────500K─◀', '▶──27%────...', '▶──27%────◀', '▶──27%──500GB─◀', '▶──27%──500Kgarbage─◀']) expect(parseOmpContext(text)).toBeNull()
  })
  it('preserves usage above the window after switching to a smaller model', () => {
    expect(parseOmpContext('▶──200K─120%◀')).toEqual({ pct: 120, total: 200_000, estimated: 240_000 })
    expect(parseOmpContext('◫ 120%/200K')).toEqual({ pct: 120, total: 200_000, estimated: 240_000 })
  })
  it('does not invent data for missing or invalid meters', () => {
    for (const text of [null, '', '51%/1M', '◫ 10%/0K', '◫ --/1M']) expect(parseOmpContext(text)).toBeNull()
  })
})

describe('usage gauges', () => {
  it('lit le /usage de Claude Code', () => {
    const screen = `   Settings  Status   Config   Usage   Stats
   Session
   Total cost:            $0.0000
   Current session
   ████                                               8% used
   Resets 2pm (America/New_York)
   Current week (all models)
   ███████████████████████████████████                70% used
   Resets Sep 28, 11pm (America/New_York)
   Current week (Fable)
   ████████████▌                                      25% used
   Resets Sep 28, 11pm (America/New_York)
   What's contributing to your limits usage?
   Esc to cancel`
    const r = parseMeters(screen)
    expect(r.meters).toEqual([
      { label: 'Current session', pct: 8, kind: 'used', reset: '2pm (America/New_York)' },
      { label: 'Current week (all models)', pct: 70, kind: 'used', reset: 'Sep 28, 11pm (America/New_York)' },
      { label: 'Current week (Fable)', pct: 25, kind: 'used', reset: 'Sep 28, 11pm (America/New_York)' },
    ])
    expect(r.rest).toContain('Total cost')
    expect(r.rest).toContain("What's contributing")
    expect(r.rest).not.toContain('Settings')
    expect(r.rest).not.toContain('Esc to cancel')
  })

  it('reads Codex\'s /status (box, reset on its own line)', async () => {
    const { unbox } = await import('../app/utils/meters')
    const screen = `╭──────────────────────────────────────╮
│  Account:              Plus          │
│  5h limit:             [█████████░░░░░░░░░░░] 43% left   │
│                        (resets 15:08)                    │
│  Weekly limit:         [████████████████░░░░] 82% left   │
│                        (resets 20:48 on 1 Oct)           │
│  Other: [██░░] 40% used (resets 14:02) │
╰──────────────────────────────────────╯`
    const r = parseMeters(unbox(screen.split('\n')).join('\n'))
    expect(r.meters).toEqual([
      { label: '5h limit', pct: 43, kind: 'left', reset: '15:08' },
      { label: 'Weekly limit', pct: 82, kind: 'left', reset: '20:48 on 1 Oct' },
      { label: 'Other', pct: 40, kind: 'used', reset: '14:02' },
    ])
    expect(r.rest).toBe('Account:              Plus')
  })
})

describe('active tab of the settings panel', async () => {
  const { activeTab } = await import('../server/utils/settingstabs')
  it('spots the word on a colored background', () => {
    const l = '\x1b[0m\x1b[1m\x1b[38;2;177;185;249mSettings\x1b[0m  Status   Config   Usage  \x1b[0m\x1b[1m\x1b[38;2;0;0;0m\x1b[48;2;177;185;249m Stats \x1b[0m\r'
    expect(activeTab(l)).toBe('Stats')
    expect(activeTab('Settings  Status  Config')).toBeNull()
  })
  it('spots the word in reverse video (Claude Code under Herdr 0.9.3)', () => {
    const l = '   \x1b[0m\x1b[1m\x1b[38;2;177;185;249mSettings\x1b[0m  Status  \x1b[0m\x1b[1m\x1b[7m Config   \x1b[0mUsage   Stats\r'
    expect(activeTab(l)).toBe('Config')
  })
  it('does not take a 7 inside a color for reverse video', () => {
    expect(activeTab('\x1b[38;2;7;7;7mSettings  Status\x1b[0m  Config')).toBeNull()
    expect(activeTab('Settings  \x1b[7mStatus\x1b[27m  Config')).toBe('Status')
  })
})
