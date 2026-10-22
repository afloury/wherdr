import { describe, expect, it } from 'vitest'
import { createSettingsSync } from '../../app/utils/syncedSettings'
import { applySettingsPatch, type SettingsMap } from '../../shared/settings'

function store(init: Record<string,string>) {
  const m = new Map(Object.entries(init))
  return { m, get: (k: string) => m.get(k) ?? null, set: (k: string, v: string) => { m.set(k, v) }, remove: (k: string) => { m.delete(k) } }
}
describe('review repro', () => {
  it('second device with its own groups loses them after another device migrated first', async () => {
    let server: SettingsMap = {}
    const transport = {
      get: async () => server,
      post: async (p: any, migrate: boolean) => { server = applySettingsPatch(server, p, migrate).next; return server },
    }
    // Phone: only a theme set.
    const phone = store({ theme: 'wherdr-graphite' })
    await createSettingsSync({ local: phone, transport }).load()
    // iPad: machine groups built before the update, never on the phone.
    const ipad = store({ machineGroups: '[{"id":"g1","name":"Work","machines":["a"]}]', compactList: '1' })
    await createSettingsSync({ local: ipad, transport }).load()
    console.log('server', JSON.stringify(server))
    console.log('ipad machineGroups after load:', ipad.get('machineGroups'), 'compactList:', ipad.get('compactList'))
    expect(ipad.get('machineGroups')).toBeNull()
  })
})
