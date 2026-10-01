import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { agentPrompt, setSocketResolver } from '../server/utils/herdr'

// Fake Herdr 0.9 server: agent launched by agent.start, already idle on screen,
// but still "starting" (launch_pending) until an agent.get has
// re-checked it after the 3 s delay (`settled`).
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

describe('agentPrompt: new agent that Herdr considers "starting"', () => {
  it('has agent.get re-check the startup, then sends the message once', async () => {
    await agentPrompt('w1:p1', 'premier message')
    expect(herdr.methods).toEqual(['agent.prompt', 'agent.get', 'agent.prompt'])
    expect(herdr.delivered).toEqual(['premier message'])
  })

  it('less than 3 s after launch: the agent_not_ready refusal goes up (message queued)', async () => {
    herdr.settled = false
    await expect(agentPrompt('w1:p1', 'trop tôt')).rejects.toMatchObject({ code: 'agent_not_ready' })
    expect(herdr.delivered).toEqual([])
  })

  it('agent.get failing: the original refusal goes up, not the agent.get error', async () => {
    herdr.getError = 'agent_not_found'
    await expect(agentPrompt('w1:p1', 'x')).rejects.toMatchObject({ code: 'agent_not_ready' })
    expect(herdr.methods).toEqual(['agent.prompt', 'agent.get'])
  })
})
