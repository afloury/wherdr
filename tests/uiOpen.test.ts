import { describe, expect, it } from 'vitest'
import { openUi, type UiOpenDeps } from '../server/utils/uiOpen'
import { parseAlfredCommand } from '../shared/pm/alfredCli'
import { parseCommand } from '../shared/pm/coordinator'
import { uiPlaceLabel } from '../shared/uiOpen'
import type { Pane } from '../shared/types'

// Alfred (_main) runs in pane p1, the WEB coordinator in p2.
// WEB was renamed: it shows WB and was once WW.
function setup(viewing: (string | null)[]) {
  const got: { pane: string | null, msgs: string[] }[] = viewing.map(pane => ({ pane, msgs: [] }))
  const terminals: Record<string, string> = { _main: 't-alfred', WEB: 't-web' }
  const deps: UiOpenDeps = {
    store: {
      project: async (k: string) => (k === 'WEB' ? { key: 'WEB', label: 'WB', aliases: ['WW'] } : undefined),
      coordinator: async (k: string) => (terminals[k] ? { project: k, tokenHash: '', terminal: terminals[k] } : null),
    } as unknown as UiOpenDeps['store'],
    panes: () => [{ id: 'p1', coreAddress: 't-alfred' }, { id: 'p2', coreAddress: 't-web' }] as Pane[],
    clients: () => got.map(g => ({ pane: g.pane, send: (d: string) => g.msgs.push(d) })),
  }
  return { deps, got }
}
const web = { scope: 'WEB', main: false, by: 'WEB coordinator' }

describe('ui open', () => {
  it('sends the place only to the apps showing the agent\'s conversation', async () => {
    const { deps, got } = setup(['p2', 'p1', null])
    const out = await openUi(deps, { ...web, raw: '/settings?section=projects&project=WEB&tab=guards', turn: 'user' })
    expect(out).toMatchObject({ opened: '#/settings?section=projects&project=WEB&tab=guards', clients: 1 })
    expect(got.map(g => g.msgs.length)).toEqual([1, 0, 0])
    expect(JSON.parse(got[0]!.msgs[0]!)).toEqual({ type: 'ui-open', pane: 'p2', link: '#/settings?section=projects&project=WEB&tab=guards', by: 'WEB coordinator' })
  })

  it('is refused in a wake turn or with no known turn', async () => {
    const { deps, got } = setup(['p1'])
    for (const turn of ['wake', 'none'] as const)
      await expect(openUi(deps, { scope: '_main', main: true, by: 'Alfred', raw: '#/settings?section=phone', turn })).rejects.toThrow(/turn that comes from the user/)
    expect(got[0]!.msgs).toEqual([])
  })

  it('keeps a coordinator to its project\'s places and the global settings', async () => {
    const { deps } = setup(['p2'])
    for (const raw of ['#/settings?section=projects&project=APP', '#/board?task=APP-3', '#/board?project=APP', '#/decisions', '#/'])
      await expect(openUi(deps, { ...web, raw, turn: 'user' })).rejects.toThrow(/project WB's places/)
    // Its shown key and former keys name it too.
    for (const raw of ['#/board?task=WEB-3', '#/board?task=WB-9', '#/board?task=ww-2', '#/board?project=web', '#/board?project=WB', '#/settings?section=projects&project=WB', '#/settings?section=phone'])
      await expect(openUi(deps, { ...web, raw, turn: 'user' })).resolves.toMatchObject({ clients: 1 })
    // Alfred opens any place.
    const alfred = setup(['p1'])
    await expect(openUi(alfred.deps, { scope: '_main', main: true, by: 'Alfred', raw: '#/decisions', turn: 'user' })).resolves.toMatchObject({ clients: 1 })
  })

  it('is refused when no open app shows the conversation, or for a non-app link', async () => {
    const { deps } = setup(['p1', null])
    await expect(openUi(deps, { ...web, raw: '#/settings?section=phone', turn: 'user' })).rejects.toThrow(/No open wherdr shows your conversation/)
    await expect(openUi(deps, { ...web, raw: 'https://example.com', turn: 'user' })).rejects.toThrow(/Not an in-app link/)
  })

  it('parses in both CLIs and names the place', () => {
    expect(parseAlfredCommand(['ui', 'open', '#/settings?section=phone'])).toEqual({ name: 'ui open', link: '#/settings?section=phone' })
    expect(parseCommand(['ui', 'open', '/board?task=WEB-3'])).toEqual({ name: 'ui open', link: '/board?task=WEB-3' })
    expect(uiPlaceLabel('#/settings?section=conversation&tab=read-aloud')).toBe('Settings › Conversation › Read aloud')
    expect(uiPlaceLabel('#/settings?section=projects&project=WEB&tab=guards')).toBe('Settings › Projects › WEB › Guards')
  })
})
