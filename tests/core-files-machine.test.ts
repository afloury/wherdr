import { describe, expect, it, vi } from 'vitest'
import { coreFilesMachine } from '../server/utils/coreFilesMachine'
import { listFiles, readFilePreview } from '../server/utils/files'

const b64 = (s: string) => Buffer.from(s).toString('base64')
const machines = () => [{ key: 'ab12', label: 'box', status: 'online' }, { key: 'cd34', label: 'gone', status: 'offline' }]

describe('coreFilesMachine', () => {
  it('uses the local disk for the local core', async () => {
    const m = await coreFilesMachine('', { machines })
    expect(m.local).toBe(true)
    expect(m.exec).toBeNull()
  })
  it('runs the file scripts through machine.exec on a remote machine, home read once', async () => {
    const call = vi.fn(async (_method: string, params: { argv: string[], on?: string }) => {
      const script = params.argv[2]!
      if (script.includes('$HOME')) return { code: 0, stdout: b64('/home/u') }
      if (script.includes('rev-parse')) return { code: 0, stdout: b64('/home/u/proj\n') }
      if (script.includes('ls -A')) return { code: 0, stdout: b64('/home/u/proj\0/home/u/proj\0d  src\0f  a.md\0=\0') }
      return { code: 0, stdout: b64('5\nhello') }
    })
    const m = await coreFilesMachine('ab12', { call: call as never, machines })
    expect(m).toMatchObject({ key: 'ab12', local: false, home: '/home/u' })
    await coreFilesMachine('ab12', { call: call as never, machines })
    expect(call.mock.calls.filter(c => (c[1] as { argv: string[] }).argv[2]!.includes('$HOME'))).toHaveLength(1)
    const listing = await listFiles(m, '/home/u/proj/src', null)
    expect(listing.entries.map(e => e.name)).toEqual(['src', 'a.md'])
    expect(call.mock.calls.every(c => (c[1] as { on?: string }).on === 'box')).toBe(true)
    const prev = await readFilePreview(m, '/home/u/proj', 'a.md')
    expect(prev).toMatchObject({ kind: 'text', text: 'hello' })
  })
  it('refuses an unknown or offline machine', async () => {
    await expect(coreFilesMachine('zz', { machines })).rejects.toThrow('unknown machine')
    await expect(coreFilesMachine('cd34', { machines })).rejects.toThrow('unreachable')
  })
})
