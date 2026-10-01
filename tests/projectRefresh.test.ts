import { describe, expect, it } from 'vitest'
import { type RefreshInput, refreshMode } from '../app/utils/projectRefresh'

const base: RefreshInput = { coordinator: true, offline: false, visible: true, pageVisible: true, available: null }

describe('panneau Projet : quand lire', () => {
  it('reload: nothing during the offline state, read as soon as the live state arrives', () => {
    // Last state kept on screen on reload: pane known, but offline.
    expect(refreshMode({ ...base, offline: true })).toBe('none')
    // The live state arrives: we read right away (no more waiting for the poll).
    expect(refreshMode(base)).toBe('poll')
  })

  it('state not received yet: read as soon as the pane becomes a known coordinator', () => {
    expect(refreshMode({ ...base, coordinator: false })).toBe('none')
    expect(refreshMode(base)).toBe('poll')
  })

  it('hidden panel: one read to know whether to show the tab, then nothing', () => {
    expect(refreshMode({ ...base, visible: false })).toBe('probe')
    expect(refreshMode({ ...base, visible: false, available: true })).toBe('none')
    expect(refreshMode({ ...base, visible: true, available: true })).toBe('poll')
  })

  it('no herdr-projects, or hidden page: no read', () => {
    expect(refreshMode({ ...base, available: false })).toBe('none')
    expect(refreshMode({ ...base, pageVisible: false })).toBe('none')
  })
})
