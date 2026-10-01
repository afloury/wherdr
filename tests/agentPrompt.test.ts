import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { agentPrompt, setSocketResolver } from '../server/utils/herdr'

// Faux serveur Herdr 0.9 : agent lancé par agent.start, déjà idle à l'écran,
// mais encore « en démarrage » (launch_pending) tant qu'un agent.get ne l'a pas
// revalidé après le délai de 3 s (`settled`).
const herdr = { settled: true, ready: false, getError: null as string | null, methods: [] as string[], delivered: [] as string[] }
let server: net.Server
let dir: string

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-'))
  const sock = path.join(dir, 'h.sock')
  server = net.createServer((c) => {
    c.setEncoding('utf8')
    c.once('data', (line: string) => {
      const { id, method, params } = JSON.parse(line)
      herdr.methods.push(method)
      let reply: Record<string, unknown>
      if (method === 'agent.get') {
        if (!herdr.getError && herdr.settled) herdr.ready = true
        reply = herdr.getError
          ? { error: { code: herdr.getError, message: herdr.getError } }
          : { result: { agent: { pane_id: params.target, interactive_ready: herdr.ready } } }
      } else if (!herdr.ready) {
        reply = { error: { code: 'agent_not_ready', message: `agent ${params.target} is not an active named agent` } }
      } else {
        herdr.delivered.push(params.text)
        reply = { result: {} }
      }
      c.end(JSON.stringify({ id, ...reply }) + '\n')
    })
  })
  await new Promise<void>(r => server.listen(sock, r))
  setSocketResolver(() => ({ sock }))
})
afterAll(() => {
  server.close()
  fs.rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => Object.assign(herdr, { settled: true, ready: false, getError: null, methods: [], delivered: [] }))

describe('agentPrompt : agent neuf que Herdr tient pour « en démarrage »', () => {
  it('fait revalider le démarrage par agent.get puis envoie le message une fois', async () => {
    await agentPrompt('w1:p1', 'premier message')
    expect(herdr.methods).toEqual(['agent.prompt', 'agent.get', 'agent.prompt'])
    expect(herdr.delivered).toEqual(['premier message'])
  })

  it('moins de 3 s après le lancement : le refus agent_not_ready remonte (message mis en attente)', async () => {
    herdr.settled = false
    await expect(agentPrompt('w1:p1', 'trop tôt')).rejects.toMatchObject({ code: 'agent_not_ready' })
    expect(herdr.delivered).toEqual([])
  })

  it('agent.get en échec : le refus d’origine remonte, pas l’erreur d’agent.get', async () => {
    herdr.getError = 'agent_not_found'
    await expect(agentPrompt('w1:p1', 'x')).rejects.toMatchObject({ code: 'agent_not_ready' })
    expect(herdr.methods).toEqual(['agent.prompt', 'agent.get'])
  })
})
