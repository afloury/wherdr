// Claude quota suggestion declined or skipped: kept per machine key in the
// data folder (server/utils/claudeSetup.ts), so no device offers it again.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { readDismissed, writeDismissed } from '../server/utils/claudeSetup'

describe('Claude quota suggestion dismissed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wherdr-claude-setup-'))
  const file = path.join(dir, 'data/claude-quotas.json')
  afterEach(() => fs.rmSync(path.dirname(file), { recursive: true, force: true }))
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('starts empty, adds and removes machine keys', () => {
    expect([...readDismissed(file)]).toEqual([])
    expect(writeDismissed(['', '0a1b2c3d'], true, file)).toEqual(['', '0a1b2c3d'])
    expect(writeDismissed(['0a1b2c3d'], true, file)).toEqual(['', '0a1b2c3d'])
    expect([...readDismissed(file)].sort()).toEqual(['', '0a1b2c3d'])
    expect(writeDismissed([''], false, file)).toEqual(['0a1b2c3d'])
  })

  it('ignores invalid keys and a damaged file', () => {
    expect(writeDismissed(['../x', 'NOT-HEX', '0a1b'], true, file)).toEqual(['0a1b'])
    fs.writeFileSync(file, '{ broken')
    expect([...readDismissed(file)]).toEqual([])
    fs.writeFileSync(file, JSON.stringify({ dismissed: ['abcd', 42, '../etc'] }))
    expect([...readDismissed(file)]).toEqual(['abcd'])
  })
})
