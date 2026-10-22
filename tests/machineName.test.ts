import { rmSync } from 'node:fs'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type * as Env from '../server/utils/env'

const dirs = vi.hoisted(() => {
  const root = `${process.env.TMPDIR || '/tmp'}/wherdr-machine-name-${process.pid}`
  process.env.DATA_DIR = root
  delete process.env.HOST_LABEL
  return { root }
})

vi.mock('../server/utils/env', async (orig) => {
  const env = await orig<typeof Env>()
  return { ...env, HOST_LABEL: 'wherdr' }
})

const { adoptTailnetName, localMachineLabel, renameMachine, selfNames } = await import('../server/utils/machines')

afterAll(() => rmSync(dirs.root, { recursive: true, force: true }))

describe('adoptTailnetName', () => {
  it('keeps its native name and ignores its own tailnet profile', () => {
    expect(localMachineLabel()).toBe('wherdr')
    adoptTailnetName(null)
    expect(localMachineLabel()).toBe('wherdr')
    adoptTailnetName('box.example.ts.net')
    expect(localMachineLabel()).toBe('wherdr')
    expect(selfNames()).toContain('box')
  })
  it('never replaces a name the user chose in the app', async () => {
    await renameMachine('', 'Kitchen')
    adoptTailnetName('other.example.ts.net')
    expect(localMachineLabel()).toBe('Kitchen')
  })
})
