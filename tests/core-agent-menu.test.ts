import { describe, expect, it, vi } from 'vitest'
import { coreAgentMenu } from '../app/utils/coreAgentMenu'

describe('coreAgentMenu', () => {
  it('lists control, reconnect, settings and close in order', () => {
    const takeControl = vi.fn()
    const items = coreAgentMenu({
      pane: undefined, takeControl, reconnect: vi.fn(), rename: vi.fn(), browseFiles: vi.fn(),
      settings: [{ label: 'S' }], close: { label: 'C' },
    })
    expect(items.map(i => i.label ?? i.kind)).toEqual(['Take control of this terminal', 'Reconnect', 'S', 'separator', 'C'])
    items[0]!.run?.()
    expect(takeControl).toHaveBeenCalled()
  })
  it('adds Rename for a pane and opens the sheet for it', () => {
    const rename = vi.fn()
    const items = coreAgentMenu({ pane: { id: 'w1:p1' } as never, takeControl: vi.fn(), reconnect: vi.fn(), rename, browseFiles: vi.fn(), settings: [], close: undefined })
    expect(items.map(i => i.label)).toContain('Rename pane')
    items.find(i => i.label === 'Rename pane')!.run?.()
    expect(rename).toHaveBeenCalledWith('w1:p1')
  })
  it('omits the close entry when absent', () => {
    const items = coreAgentMenu({ pane: undefined, takeControl: vi.fn(), reconnect: vi.fn(), rename: vi.fn(), browseFiles: vi.fn(), settings: [], close: undefined })
    expect(items).toHaveLength(2)
  })
  it('adds Browse files for an agent with a folder', () => {
    const browseFiles = vi.fn()
    const items = coreAgentMenu({ pane: { id: 'w:p1' } as never, takeControl: vi.fn(), reconnect: vi.fn(), rename: vi.fn(), browseFiles, settings: [], close: undefined })
    const item = items.find(i => i.label === 'Browse files')!
    item.run?.()
    expect(browseFiles).toHaveBeenCalled()
  })
})
