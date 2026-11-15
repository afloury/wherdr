// /api/auth/status: the machine name only once unlocked (the lock screen does
// not show it, a locked client learns nothing about the host).
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createAuth } from '../server/utils/auth'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

it('gives the host label to an unlocked client only', async () => {
  const auth = createAuth({ dataDir: mkdtempSync(path.join(tmpdir(), 'hw-status-')) })
  auth._db().credentials.push({ id: 'k1', publicKey: 'x', counter: 0, transports: [], name: 'iPhone', createdAt: '2026-01-01T00:00:00.000Z' })
  for (const [name, value] of Object.entries({
    defineApi: (h: unknown) => h, auth, reqOf: (e: { headers: Record<string, string> }) => e,
    getQuery: () => ({}), localMachineLabel: () => 'studio',
  })) vi.stubGlobal(name, value)
  const handler = (await import('../server/api/auth/status.get')).default as unknown as (e: unknown) => Record<string, unknown>
  expect(handler({ headers: {} })).toEqual({ enabled: true, unlocked: false, expiresAt: null, devices: [] })
  const cookie = auth._sessionCookie({ headers: {} }).split(';')[0]!
  expect(handler({ headers: { cookie } })).toMatchObject({ unlocked: true, hostLabel: 'studio', devices: [{ name: 'iPhone' }] })
})
