import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
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

afterAll(() => rmSync(dirs.root, { recursive: true, force: true }))

describe('local machine name', () => {
  it('is the host label, unless the user named the machine in the app', async () => {
    vi.resetModules()
    expect((await import('../server/utils/machines')).localMachineLabel()).toBe('wherdr')
    mkdirSync(dirs.root, { recursive: true })
    writeFileSync(`${dirs.root}/machine-label.txt`, 'Kitchen\n')
    vi.resetModules()
    expect((await import('../server/utils/machines')).localMachineLabel()).toBe('Kitchen')
  })
})
