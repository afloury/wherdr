import { describe, expect, it } from 'vitest'
import { CoreError } from '../server/utils/core'
import { coreQuotaMachines } from '../server/utils/coreQuotaMachines'
import type { CoreAdminDeps } from '../server/utils/coreCreate'
import type { MachineInfo } from '../shared/types'

const b64 = (s: string) => Buffer.from(s).toString('base64')
const machines: MachineInfo[] = [
  { key: '', label: 'Local', local: true, status: 'online', error: null },
  { key: '7667', label: 'vps', local: false, status: 'online', error: null },
  { key: '6f66', label: 'off', local: false, status: 'offline', error: null },
]
function deps(reply: (params: any) => unknown) {
  const calls: any[] = []
  const d: CoreAdminDeps = {
    call: async (method, params) => {
      calls.push([method, params])
      const r = reply(params)
      if (r instanceof Error) throw r
      return r as never
    },
    machines: () => machines, panes: () => [], settle: async () => {}, recent: async () => [], remember: async () => {},
  }
  return { d, calls }
}

describe('coreQuotaMachines', () => {
  it('lists the local disk, online core machines with their home, and offline ones with none', async () => {
    const { d, calls } = deps(() => ({ code: 0, stdout: b64('/home/u') }))
    const [local, vps, off] = await coreQuotaMachines(d)
    expect(local).toMatchObject({ key: '', local: true })
    expect(local!.home).toBeTruthy()
    expect(vps).toMatchObject({ key: '7667', local: false, home: '/home/u' })
    expect(off).toMatchObject({ key: '6f66', home: '' })
    expect(calls).toHaveLength(1)
    expect(calls[0][1]).toMatchObject({ on: 'vps' })
  })

  it('reads remote files through machine.exec and sends the install script on stdin', async () => {
    const { d, calls } = deps(p => (p.argv[2].startsWith('printf') ? { code: 0, stdout: b64('/home/u') } : { code: 0, stdout: b64('hello') }))
    const vps = (await coreQuotaMachines(d))[1]!
    expect(await vps.fs.readFile('/home/u/.claude/x')).toBe('hello')
    const r = await vps.exec!('exec sh -s', [], { input: Buffer.from('#!/bin/sh'), timeoutMs: 60000 })
    expect(r.stdout.toString()).toBe('hello')
    const last = calls.at(-1)[1]
    expect(last.input).toBe(b64('#!/bin/sh'))
    expect(last.timeout).toBe(60)
  })

  it('reports an unreachable core as exit 255 and a timeout as 124', async () => {
    const { d } = deps(p => (p.argv[2].startsWith('printf') ? { code: 0, stdout: b64('/h') } : new CoreError('timeout', 'x')))
    const vps = (await coreQuotaMachines(d))[1]!
    expect((await vps.exec!('true')).code).toBe(255)
    const t = deps(p => (p.argv[2].startsWith('printf') ? { code: 0, stdout: b64('/h') } : { code: null, stdout: '', timed_out: true }))
    expect((await (await coreQuotaMachines(t.d))[1]!.exec!('true')).code).toBe(124)
  })
})
