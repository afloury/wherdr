import { describe, expect, it } from 'vitest'
import { FrameSplitter, decodeServerFrame, frame, helloFrame } from '../server/utils/herdrEndpoint'
import {
  NoticeDeduper, findThreadPane, forwardableNotice, noticeKey, projectThreadOfNotice, shouldNotifyNotice,
} from '../server/utils/notificationPolicy'

// Trame capturée sur Herdr 0.9.1 (session de test) après
// `herdr notification show "Build terminé" --body "api · 3 tests" --sound done`.
const NOTIF = Buffer.from('0e030e4275696c64207465726d696ec3a9010e61706920c2b7203320746573747301000000000000', 'hex')

describe('protocole d’endpoint de Herdr', () => {
  it('annonce un client shell passif (surface inactive)', () => {
    const f = helloFrame()
    const len = f.readUInt32LE(0)
    expect(len).toBe(f.length - 4)
    expect(f[4]).toBe(20) // ClientMessage::EndpointControl
    const p = f.subarray(5)
    expect(p[0]).toBe('endpoint.hello.v1'.length)
    expect(p.subarray(1, 18).toString()).toBe('endpoint.hello.v1')
    // Longueur du JSON en varint (u16 : 251 puis 2 octets, au-delà de 250 octets).
    const wide = p[18] === 251
    const jsonLen = wide ? p.readUInt16LE(19) : p[18]!
    const start = wide ? 21 : 19
    expect(jsonLen).toBe(p.length - start)
    const json = JSON.parse(p.subarray(start).toString())
    expect(json).toMatchObject({ generation: 1, surface_active: false, mouse_capture: false })
    expect(json.snapshot_codecs).toEqual(['shell.snapshot.v1'])
  })

  it('lit une notification réelle', () => {
    expect(decodeServerFrame(NOTIF)).toEqual({
      type: 'notification',
      notification: {
        kind: 'custom', title: 'Build terminé', body: 'api · 3 tests', sound: 'done',
        agent: null, workspaceId: null, tabId: null, paneId: null,
      },
    })
  })

  it('lit les contrôles nommés et ignore le reste', () => {
    const str = (s: string) => { const b = Buffer.from(s); return Buffer.concat([Buffer.from([b.length]), b]) }
    expect(decodeServerFrame(Buffer.concat([Buffer.from([20]), str('endpoint.welcome.v1'), str('{"generation":1}')])))
      .toEqual({ type: 'control', kind: 'endpoint.welcome.v1', data: '{"generation":1}' })
    expect(decodeServerFrame(Buffer.from([8, 0, 0]))).toEqual({ type: 'other', tag: 8 })
    expect(decodeServerFrame(Buffer.from([3, 0]))).toEqual({ type: 'shutdown' })
    expect(() => decodeServerFrame(NOTIF.subarray(0, 10))).toThrow()
  })

  it('recolle les trames coupées n’importe où', () => {
    const s = new FrameSplitter()
    const all = Buffer.concat([frame(NOTIF), frame(Buffer.from([8, 0, 0])), frame(NOTIF)])
    const got: Buffer[] = []
    for (let i = 0; i < all.length; i += 7) got.push(...s.push(all.subarray(i, i + 7)))
    expect(got.map(g => decodeServerFrame(g).type)).toEqual(['notification', 'other', 'notification'])
  })
})

describe('notifications herdr -> push', () => {
  const n = (kind: string, title: string, body: string | null = null) => ({ kind, title, body })

  it('ne relaie que les notifications custom (les états des agents sont déjà notifiés)', () => {
    expect(forwardableNotice(n('custom', 'Build terminé'))).toBe(true)
    expect(forwardableNotice(n('needs_attention', 'claude needs attention'))).toBe(false)
    expect(forwardableNotice(n('finished', 'codex finished'))).toBe(false)
    expect(forwardableNotice(n('custom', '  '))).toBe(false)
  })

  it('applique « Notifier pour » aux threads herdr-projects', () => {
    expect(projectThreadOfNotice('Wherdr · t-0015')).toEqual({ project: 'Wherdr', thread: 't-0015' })
    expect(projectThreadOfNotice('Wherdr · gh')).toBeNull()
    expect(projectThreadOfNotice('herdr-projects doctor')).toBeNull()
    expect(shouldNotifyNotice(undefined, 'Wherdr · t-0015')).toBe(false)
    expect(shouldNotifyNotice('project_leads', 'Wherdr · t-0015')).toBe(false)
    expect(shouldNotifyNotice('all', 'Wherdr · t-0015')).toBe(true)
    // Notifications du projet lui-même, d'autres plugins : pour tous.
    expect(shouldNotifyNotice(undefined, 'Wherdr')).toBe(true)
    expect(shouldNotifyNotice(undefined, 'Build terminé')).toBe(true)
  })

  it('retrouve le pane du thread pour le lien', () => {
    const panes = [
      { id: 'w1:p1', name: 'coordinator', cwd: '/home/user/.herdr-projects/wherdr' },
      { id: 'w2:p1', name: null, cwd: '/home/user/.herdr/worktrees/herdr-web/hp-wherdr-t-0015-actions-des-plugins' },
      { id: 'w3:p1', name: 'hp-demo-t-0015-other', cwd: '/tmp' },
      { id: 'w4:p1', name: null, cwd: '/home/user/.herdr/worktrees/herdr-web/hp-wherdr-t-0150' },
    ]
    expect(findThreadPane(panes, 'Wherdr', 't-0015')?.id).toBe('w2:p1')
    expect(findThreadPane(panes, 'Demo', 't-0015')?.id).toBe('w3:p1')
    expect(findThreadPane(panes, 'Wherdr', 't-0099')).toBeNull()
    // Nom de projet humanisé (« My App » pour my-app).
    expect(findThreadPane([{ id: 'a', name: 'hp-my-app-t-0002', cwd: null }], 'My App', 't-0002')?.id).toBe('a')
  })

  it('supprime les doublons dans la fenêtre', () => {
    const d = new NoticeDeduper(60000)
    const k = noticeKey(n('custom', 'Wherdr · t-0015', 'review · new report'))
    expect(d.fresh(k, 1000)).toBe(true)
    expect(d.fresh(k, 30000)).toBe(false)
    expect(d.fresh(noticeKey(n('custom', 'Wherdr · t-0015', 'PR #3 merged')), 30000)).toBe(true)
    expect(d.fresh(k, 62000)).toBe(true)
  })
})
