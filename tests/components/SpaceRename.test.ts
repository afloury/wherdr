import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { herdrState } from '~/composables/useHerdr'
import { renameSpace, saveSpaceName, workspaceItems } from '~/composables/useSpaces'

const { api, toast } = vi.hoisted(() => ({ api: vi.fn(), toast: vi.fn() }))
mockNuxtImport('api', () => api)
mockNuxtImport('toast', () => toast)
mockNuxtImport('haptic', () => vi.fn())

describe('space rename actions', () => {
  afterEach(() => {
    renameSpace.value = null
    herdrState.value = { ok: false, workspaces: [], panes: [] }
    vi.resetAllMocks()
  })

  it('project menus omit workspace rename while ordinary spaces keep it', () => {
    expect(workspaceItems('w1', true).map(x => x.label)).not.toContain('Rename space')
    expect(workspaceItems('w1').map(x => x.label)).toContain('Rename space')
    herdrState.value = { ok: true, workspaces: [{ id: 'w1', label: 'new-folder', number: 1, status: null, worktree: false }], panes: [] }
  })

  for (const reply of ['refused', 'unconfirmed']) {
    it(`keeps the rename sheet open and shows an error when ${reply}`, async () => {
      renameSpace.value = { kind: 'workspace', id: 'w1', label: 'old' }
      if (reply === 'refused') api.mockRejectedValue(new Error('Rename failed'))
      else api.mockResolvedValue({ ok: false })
      await saveSpaceName('new')
      expect(renameSpace.value).not.toBeNull()
      expect(toast).toHaveBeenCalledWith(expect.stringContaining('Rename failed'), true)
      expect(toast).not.toHaveBeenCalledWith('Renamed')
    })
  }

  it('closes the sheet only after a confirmed rename', async () => {
    renameSpace.value = { kind: 'workspace', id: 'w1', label: 'old' }
    api.mockResolvedValue({ ok: true })
    await saveSpaceName('new')
    expect(renameSpace.value).toBeNull()
    expect(toast).toHaveBeenCalledWith('Renamed')
  })
})
