import { describe, expect, it } from 'vitest'
import { installedAgentKinds } from '../server/utils/agentAvailability'
import type { Machine } from '../server/utils/machines'

describe('installedAgentKinds', () => {
  it('reads the remote machine executables and keeps the inventories separate', async () => {
    const machine = (key: string, output: string) => ({
      key, local: false, status: 'online',
      exec: async () => ({ code: 0, stdout: Buffer.from(output), stderr: '' }),
    }) as unknown as Machine
    expect(await installedAgentKinds(machine('test-gemini', 'gemini\nopencode\n'))).toEqual(['gemini', 'opencode'])
    expect(await installedAgentKinds(machine('test-kimi', 'kimi\n'))).toEqual(['kimi'])
  })
})
