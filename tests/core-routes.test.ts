import { describe, expect, it } from 'vitest'
import { coreRouteAllowed } from '../shared/coreRoutes'

describe('coreRouteAllowed', () => {
  it.each([
    '/api/state', '/api/state?x=1', '/api/auth', '/api/auth/login', '/api/core/session', '/api/health',
    '/api/chat', '/api/chat/image?pane=1', '/api/search?q=a', '/api/dirs?path=/', '/api/machine/add',
    '/api/machine/core', '/api/machine/core-rename', '/api/machine/core-forget', '/api/keep?pane=1',
    '/api/upload', '/api/attach', '/api/file', '/api/client-plugins', '/api/client-plugins/x',
  ])('allows %s', (p) => { expect(coreRouteAllowed(p)).toBe(true) })

  it.each([
    '/api/models', '/api/model', '/api/effort', '/api/restart', '/api/codex-update', '/api/tasks/1',
    '/api/statex', '/api/authx', '/api/machine', '/api/machine/remove', '/api/chat/other', '/api/stat', '/state',
  ])('refuses %s', (p) => { expect(coreRouteAllowed(p)).toBe(false) })
  it('allows the phone address and reads the version, but never the self-update', () => {
    expect(coreRouteAllowed('/api/phone')).toBe(true)
    expect(coreRouteAllowed('/api/phone', 'POST')).toBe(true)
    expect(coreRouteAllowed('/api/update?x=1')).toBe(true)
    expect(coreRouteAllowed('/api/update', 'GET')).toBe(true)
    expect(coreRouteAllowed('/api/update', 'POST')).toBe(false)
    expect(coreRouteAllowed('/api/update/status')).toBe(false)
  })
  it('answers the file browser routes', () => {
    for (const r of ['/api/files?pane=x', '/api/files/read?pane=x&path=a', '/api/files/download?pane=x']) expect(coreRouteAllowed(r)).toBe(true)
  })
})
