import { describe, expect, it } from 'vitest'
import { openUi, type UiOpenDeps } from '../server/utils/uiOpen'
import { parseAlfredCommand } from '../shared/pm/alfredCli'
import { parseCommand } from '../shared/pm/coordinator'
import { parseOpenLine, uiPlaceLabel, type UiDevice } from '../shared/uiOpen'
import type { Pane } from '../shared/types'

// Alfred (_main) runs in pane p1, the WEB coordinator in p2.
// WEB was renamed: it shows WB and was once WW.
// Each app: the conversation it shows, its kind, minutes since last used.
type App = string | null | { pane: string, device: UiDevice, ago: number }
function setup(viewing: App[]) {
  const now = Date.now()
  const got = viewing.map(v => typeof v === 'object' && v
    ? { pane: v.pane, device: v.device, activeAt: now - v.ago * 60_000, msgs: [] as string[] }
    : { pane: v, device: undefined, activeAt: now, msgs: [] as string[] })
  const terminals: Record<string, string> = { _main: 't-alfred', WEB: 't-web' }
  const deps: UiOpenDeps = {
    store: {
      project: async (k: string) => (k === 'WEB' ? { key: 'WEB', label: 'WB', aliases: ['WW'] } : undefined),
      coordinator: async (k: string) => (terminals[k] ? { project: k, tokenHash: '', terminal: terminals[k] } : null),
    } as unknown as UiOpenDeps['store'],
    panes: () => [{ id: 'p1', coreAddress: 't-alfred' }, { id: 'p2', coreAddress: 't-web' }] as Pane[],
    clients: () => got.map(g => ({ pane: g.pane, device: g.device, activeAt: g.activeAt, send: (d: string) => g.msgs.push(d) })),
  }
  return { deps, got }
}
const web = { scope: 'WEB', main: false, by: 'WEB coordinator' }

describe('ui open', () => {
  it('goes to the device the user is on: a card on the phone, the side panel on a computer', async () => {
    const link = '#/settings?section=projects&project=WEB&tab=guards'
    // Phone used a minute ago, a computer left on the same conversation, another conversation.
    const phone = setup([{ pane: 'p2', device: 'phone', ago: 1 }, { pane: 'p2', device: 'computer', ago: 40 }, { pane: 'p1', device: 'computer', ago: 0 }])
    await expect(openUi(phone.deps, { ...web, raw: link, turn: 'user' })).resolves.toMatchObject({ opened: link, 'opened on': 'phone' })
    expect(phone.got.map(g => g.msgs.length)).toEqual([1, 0, 0])
    expect(JSON.parse(phone.got[0]!.msgs[0]!)).toEqual({ type: 'ui-open', pane: 'p2', link, by: 'WEB coordinator', show: 'card' })
    // The other way round.
    const desk = setup([{ pane: 'p2', device: 'phone', ago: 30 }, { pane: 'p2', device: 'computer', ago: 2 }])
    const out = await openUi(desk.deps, { ...web, raw: link, turn: 'user' })
    expect(out).toMatchObject({ 'opened on': 'computer' })
    expect(out.note).toContain(`\`\`\`wherdr\nopen ${link}\n\`\`\``)
    expect(desk.got.map(g => g.msgs.length)).toEqual([0, 1])
    expect(JSON.parse(desk.got[1]!.msgs[0]!)).toMatchObject({ show: 'panel' })
    // Not in use for a while: the coordinator gives the link instead.
    const idle = setup([{ pane: 'p2', device: 'phone', ago: 60 }])
    await expect(openUi(idle.deps, { ...web, raw: link, turn: 'user' })).rejects.toThrow(/No open wherdr is in use/)
    expect(idle.got[0]!.msgs).toEqual([])
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
      await expect(openUi(deps, { ...web, raw, turn: 'user' })).resolves.toMatchObject({ 'opened on': 'phone' })
    // Alfred opens any place.
    const alfred = setup(['p1'])
    await expect(openUi(alfred.deps, { scope: '_main', main: true, by: 'Alfred', raw: '#/decisions', turn: 'user' })).resolves.toMatchObject({ 'opened on': 'phone' })
  })

  it('is refused when no open app shows the conversation, or for a non-app link', async () => {
    const { deps } = setup(['p1', null])
    await expect(openUi(deps, { ...web, raw: '#/settings?section=phone', turn: 'user' })).rejects.toThrow(/No open wherdr is in use/)
    await expect(openUi(deps, { ...web, raw: 'https://example.com', turn: 'user' })).rejects.toThrow(/Not an in-app link/)
  })

  it('parses in both CLIs and names the place', () => {
    expect(parseAlfredCommand(['ui', 'open', '#/settings?section=phone'])).toEqual({ name: 'ui open', link: '#/settings?section=phone' })
    expect(parseCommand(['ui', 'open', '/board?task=WEB-3'])).toEqual({ name: 'ui open', link: '/board?task=WEB-3' })
    expect(uiPlaceLabel('#/settings?section=conversation&tab=read-aloud')).toBe('Settings › Conversation › Read aloud')
    expect(uiPlaceLabel('#/settings?section=projects&project=WEB&tab=guards')).toBe('Settings › Projects › WEB › Guards')
    // The card kept in the reply: `open <link>`, quoted or not.
    expect(parseOpenLine('open \'#/board?project=WEB\'')).toBe('#/board?project=WEB')
    expect(parseOpenLine('open https://example.com')).toBeNull()
  })
})
