import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const sendNotification = vi.fn()
vi.mock('web-push', () => ({
  default: {
    generateVAPIDKeys: () => ({ publicKey: 'pub', privateKey: 'priv' }),
    setVapidDetails: () => {},
    sendNotification: (...args: unknown[]) => sendNotification(...args),
  },
}))

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wherdr-push-'))
let push: typeof import('../server/utils/push')

beforeAll(async () => {
  process.env.DATA_DIR = dir
  process.env.APP_URL = 'https://wherdr.example/'
  vi.resetModules()
  push = await import('../server/utils/push')
  push.initVapid()
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const sub = (endpoint: string): import('../server/utils/push').PushSub =>
  ({ endpoint, keys: { p256dh: 'k', auth: 'a' }, lang: 'fr', addedAt: '2026-01-01T00:00:00.000Z' })

describe('envoi Web Push', () => {
  it('keeps a subscription saved during sending while removing dead devices', async () => {
    await push.writeSubs([sub('https://push.example/dead'), sub('https://push.example/live')])
    sendNotification.mockImplementation(async (s: { endpoint: string }) => {
      if (s.endpoint.endsWith('/dead')) {
        // A new device subscribes while sending is in progress.
        await push.writeSubs([...await push.readSubs(), sub('https://push.example/new')])
        throw Object.assign(new Error('gone'), { statusCode: 410 })
      }
    })
    expect(await push.pushSend({ title: 't', body: 'b', tag: 'x', url: '/' })).toBe(1)
    expect((await push.readSubs()).map(s => s.endpoint)).toEqual(['https://push.example/live', 'https://push.example/new'])
  })

  it('sends each device its language, English by default', async () => {
    const en = { ...sub('https://push.example/en'), lang: 'en' as const }
    const old = { ...sub('https://push.example/old'), lang: undefined as unknown as 'en' }
    await push.writeSubs([sub('https://push.example/fr'), en, old])
    const got: Record<string, { title: string, body: string, titleFr?: string }> = {}
    sendNotification.mockReset()
    sendNotification.mockImplementation(async (s: { endpoint: string }, body: string) => { got[s.endpoint.split('/').pop()!] = JSON.parse(body) })
    const { title, titleFr } = push.agentNotificationTitle('blocked', 'Claude')
    expect(await push.pushSend({ title, titleFr, body: 'Run it?', tag: 'x', url: '/' })).toBe(3)
    expect(got.fr!.title).toBe('Claude attend ta réponse')
    expect(got.en!.title).toBe('Claude needs your input')
    expect(got.old!.title).toBe('Claude needs your input')
    expect(got.en!.body).toBe('Run it?')
    expect(got.fr!.titleFr).toBeUndefined()
  })
})
