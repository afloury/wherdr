import { describe, expect, it, vi } from 'vitest'
import { compareVersions, installMode, parseVersion, updateCommand } from '../shared/updates'
import { RELEASES_URL, createUpdateChecker } from '../server/utils/updates'

describe('versions', () => {
  it('reads numbers with or without v', () => {
    expect(parseVersion('v1.2.3')).toEqual([1, 2, 3])
    expect(parseVersion('1.10.0-beta.1')).toEqual([1, 10, 0])
    expect(parseVersion('latest')).toBeNull()
  })
  it('compares numerically', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0)
    expect(compareVersions('v1.1.0', '1.1.0')).toBe(0)
    expect(compareVersions('1.0.9', '1.1.0')).toBeLessThan(0)
    expect(compareVersions('n/a', '1.0.0')).toBe(0)
  })
})

describe('update command', () => {
  it('follows the installation mode', () => {
    expect(installMode('docker')).toBe('docker')
    expect(installMode('docker-build')).toBe('docker-build')
    expect(installMode('npm')).toBe('npm')
    expect(installMode('brew')).toBe('brew')
    expect(installMode(undefined)).toBe('native')
    expect(installMode('autre')).toBe('native')
    expect(updateCommand('docker')).toBe('docker compose pull && docker compose up -d')
    expect(updateCommand('docker-build')).toContain('docker-compose.build.yml up -d --build')
    expect(updateCommand('native')).toBe('git pull && npm ci && npm run build')
    expect(updateCommand('npm')).toBe('npx wherdr@latest')
    expect(updateCommand('brew')).toBe('brew upgrade wherdr')
  })
})

function release(tag: string) {
  return vi.fn(async (_url: string) => ({ ok: true, json: async () => ({ tag_name: tag, html_url: `https://example.test/releases/${tag}` }) }))
}

describe('release check', () => {
  it('reports a newer version', async () => {
    const fetch = release('v1.2.0')
    const check = createUpdateChecker({ current: '1.1.0', env: { WHERDR_INSTALL: 'docker' }, fetch })
    const u = await check()
    expect(fetch).toHaveBeenCalledWith(RELEASES_URL)
    expect(u).toEqual({ current: '1.1.0', latest: '1.2.0', url: 'https://example.test/releases/v1.2.0', checked: true, mode: 'docker', command: 'docker compose pull && docker compose up -d' })
  })

  it('says nothing when up to date or ahead', async () => {
    expect((await createUpdateChecker({ current: '1.2.0', env: {}, fetch: release('v1.2.0') })()).latest).toBeNull()
    const u = await createUpdateChecker({ current: '1.3.0', env: {}, fetch: release('v1.2.0') })()
    expect(u.latest).toBeNull()
    expect(u.checked).toBe(true)
  })

  it('keeps the result for a day', async () => {
    let t = 0
    const fetch = release('v2.0.0')
    const check = createUpdateChecker({ current: '1.0.0', env: {}, fetch, now: () => t })
    await Promise.all([check(), check()])
    t += 23 * 3600e3
    await check()
    expect(fetch).toHaveBeenCalledTimes(1)
    t += 2 * 3600e3
    await check()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('retries an hour after a failure', async () => {
    let t = 0
    const fetch = vi.fn(async () => ({ ok: false, json: async () => ({}) }))
    const check = createUpdateChecker({ current: '1.0.0', env: {}, fetch, now: () => t })
    expect(await check()).toMatchObject({ latest: null, checked: false })
    t += 30 * 60e3
    await check()
    expect(fetch).toHaveBeenCalledTimes(1)
    t += 31 * 60e3
    await check()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('WHERDR_UPDATE_CHECK=off : aucun appel', async () => {
    const fetch = release('v9.0.0')
    const u = await createUpdateChecker({ current: '1.0.0', env: { WHERDR_UPDATE_CHECK: 'OFF' }, fetch })()
    expect(fetch).not.toHaveBeenCalled()
    expect(u).toMatchObject({ latest: null, checked: false, mode: 'native' })
  })
})
