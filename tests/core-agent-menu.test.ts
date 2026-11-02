import { describe, expect, it, vi } from 'vitest'
import { coreAgentMenu } from '../app/utils/coreAgentMenu'

describe('coreAgentMenu', () => {
  it('lists control, reconnect, settings and close in order', () => {
    const takeControl = vi.fn()
    const items = coreAgentMenu({
      pane: undefined, takeControl, reconnect: vi.fn(),
      settings: [{ label: 'S' }], close: { label: 'C' },
    })
    expect(items.map(i => i.label ?? i.kind)).toEqual(['Take control of this terminal', 'Reconnect', 'S', 'separator', 'C'])
    items[0]!.run?.()
    expect(takeControl).toHaveBeenCalled()
  })
  it('omits the close entry when absent', () => {
    const items = coreAgentMenu({ pane: undefined, takeControl: vi.fn(), reconnect: vi.fn(), settings: [], close: undefined })
    expect(items).toHaveLength(2)
  })
})
