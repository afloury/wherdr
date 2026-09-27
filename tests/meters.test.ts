import { describe, expect, it } from 'vitest'
import { parseMeters } from '../app/utils/meters'

describe('jauges d’utilisation', () => {
  it('lit le /usage de Claude Code', () => {
    const screen = `   Settings  Status   Config   Usage   Stats
   Session
   Total cost:            $0.0000
   Current session
   ████                                               8% used
   Resets 2pm (Australia/Brisbane)
   Current week (all models)
   ███████████████████████████████████                70% used
   Resets Sep 28, 11pm (Australia/Brisbane)
   Current week (Fable)
   ████████████▌                                      25% used
   Resets Sep 28, 11pm (Australia/Brisbane)
   What's contributing to your limits usage?
   Esc to cancel`
    const r = parseMeters(screen)
    expect(r.meters).toEqual([
      { label: 'Current session', pct: 8, kind: 'used', reset: '2pm (Australia/Brisbane)' },
      { label: 'Current week (all models)', pct: 70, kind: 'used', reset: 'Sep 28, 11pm (Australia/Brisbane)' },
      { label: 'Current week (Fable)', pct: 25, kind: 'used', reset: 'Sep 28, 11pm (Australia/Brisbane)' },
    ])
    expect(r.rest).toContain('Total cost')
    expect(r.rest).toContain("What's contributing")
    expect(r.rest).not.toContain('Settings')
    expect(r.rest).not.toContain('Esc to cancel')
  })

  it('lit le /status de Codex (encadré, réinitialisation à la ligne)', async () => {
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

describe('onglet actif du panneau de réglages', async () => {
  const { activeTab } = await import('../server/utils/settingstabs')
  it('repère le mot sur fond coloré', () => {
    const l = '\x1b[0m\x1b[1m\x1b[38;2;177;185;249mSettings\x1b[0m  Status   Config   Usage  \x1b[0m\x1b[1m\x1b[38;2;0;0;0m\x1b[48;2;177;185;249m Stats \x1b[0m\r'
    expect(activeTab(l)).toBe('Stats')
    expect(activeTab('Settings  Status  Config')).toBeNull()
  })
})
