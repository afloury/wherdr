// The name shown for this machine. In Docker the container's host name is
// "wherdr" unless HOST_LABEL says otherwise: the name Tailscale gives the
// machine is shown instead, and a name the user chose always wins.
import { rmSync } from 'node:fs'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type * as Env from '../server/utils/env'

const dirs = vi.hoisted(() => {
  const root = `${process.env.TMPDIR || '/tmp'}/wherdr-machine-name-${process.pid}`
  process.env.DATA_DIR = root
  delete process.env.HOST_LABEL
  return { root }
})

// A container without HOST_LABEL, whatever machine runs the tests.
vi.mock('../server/utils/env', async (orig) => {
  const env = await orig<typeof Env>()
  return { ...env, HOST_LABEL: 'wherdr', machineLabel: (name: string | null | undefined) => env.machineLabel(name, 'wherdr', true) }
})

const { machineLabel } = await vi.importActual<typeof Env>('../server/utils/env')
const { adoptTailnetName, localMachineLabel, renameMachine, selfNames } = await import('../server/utils/machines')

afterAll(() => rmSync(dirs.root, { recursive: true, force: true }))

describe('machineLabel', () => {
  it('shows the short Tailscale name in place of the container name', () => {
    expect(machineLabel('box.example.ts.net', 'wherdr', true)).toBe('box')
    expect(machineLabel('box', 'wherdr', true)).toBe('box')
  })
  it('keeps the container name while Tailscale gives none', () => {
    for (const none of [null, undefined, '', '.example.ts.net']) expect(machineLabel(none, 'wherdr', true)).toBe('wherdr')
  })
  it('keeps a HOST_LABEL the user set and a real host name', () => {
    expect(machineLabel('box.example.ts.net', 'my server', false)).toBe('my server')
  })
  it('cuts an overlong name like HOST_LABEL', () => {
    expect(machineLabel(`${'a'.repeat(60)}.example.ts.net`, 'wherdr', true)).toHaveLength(40)
  })
})

describe('adoptTailnetName', () => {
  it('renames the machine once Tailscale is read, and ignores its own profile', () => {
    expect(localMachineLabel()).toBe('wherdr')
    adoptTailnetName(null)
    expect(localMachineLabel()).toBe('wherdr')
    adoptTailnetName('box.example.ts.net')
    expect(localMachineLabel()).toBe('box')
    expect(selfNames()).toContain('box')
  })
  it('never replaces a name the user chose in the app', async () => {
    await renameMachine('', 'Kitchen')
    adoptTailnetName('other.example.ts.net')
    expect(localMachineLabel()).toBe('Kitchen')
  })
})
