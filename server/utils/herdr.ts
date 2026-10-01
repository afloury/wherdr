// Herdr API socket: line-delimited JSON, one connection per request.
//   {"id","method","params"}\n -> {"id","result"} or {"id","error":{code,message}}
// Several machines: each Herdr server has its socket (local, or remote
// socket forwarded over SSH, see machines.ts). Calls are routed according to
// the ID of the pane / workspace they target ("<machine>~" prefix, see shared/ids.ts).
import net from 'node:net'
import { HERDR_SOCK } from './env'
import { LOCAL, routeParams } from '../../shared/ids'

export class HerdrError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

// Socket of a machine (null: unreachable for now, with the reason).
export type SocketResolver = (machine: string) => { sock: string | null, error?: string }
let resolveSocket: SocketResolver = m => (m === LOCAL ? { sock: HERDR_SOCK } : { sock: null, error: `machine inconnue : ${m}` })
export function setSocketResolver(fn: SocketResolver) { resolveSocket = fn }

// Routed call: the machine is that of the targeted pane / workspace (local otherwise).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function herdr<T = any>(method: string, params: Record<string, unknown> = {}, timeoutMs = 15000): Promise<T> {
  let routed
  try { routed = routeParams(params) }
  catch (e) { return Promise.reject(new HerdrError('bad_pane', (e as Error).message)) }
  return herdrOn<T>(routed.machine ?? LOCAL, method, routed.params, timeoutMs)
}

// Call on a given machine (IDs already local to that machine).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function herdrOn<T = any>(machine: string, method: string, params: Record<string, unknown> = {}, timeoutMs = 15000): Promise<T> {
  const r = resolveSocket(machine)
  if (!r.sock) return Promise.reject(new HerdrError('unreachable', r.error || 'machine injoignable'))
  return herdrSock<T>(r.sock, method, params, timeoutMs)
}

let reqSeq = 0
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function herdrSock<T = any>(path: string, method: string, params: Record<string, unknown> = {}, timeoutMs = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(path)
    let buf = ''
    let done = false
    const finish = (err: Error | null, val?: T) => {
      if (done) return
      done = true
      clearTimeout(timer)
      sock.destroy()
      if (err) reject(err)
      else resolve(val as T)
    }
    const timer = setTimeout(() => finish(new HerdrError('timeout', `herdr ${method}: timeout`)), timeoutMs)
    sock.setEncoding('utf8')
    sock.on('connect', () => {
      sock.write(JSON.stringify({ id: `web:${++reqSeq}`, method, params }) + '\n')
    })
    sock.on('data', (chunk: string) => {
      buf += chunk
      const nl = buf.indexOf('\n')
      if (nl < 0) return
      let msg: { result?: T, error?: { code: string, message: string } }
      try { msg = JSON.parse(buf.slice(0, nl)) }
      catch (e) { return finish(new HerdrError('bad_response', (e as Error).message)) }
      if (msg.error) finish(new HerdrError(msg.error.code, msg.error.message))
      else finish(null, msg.result)
    })
    sock.on('error', (e: NodeJS.ErrnoException) => finish(new HerdrError('unreachable', `serveur Herdr injoignable (${e.code || e.message})`)))
    sock.on('close', () => finish(new HerdrError('closed', 'Herdr connection closed without a response')))
  })
}

// Message to an agent. An agent launched by agent.start stays "starting"
// (launch_pending, agent.prompt refused with agent_not_ready) until Herdr has
// re-checked its startup, which it only does on a state change of
// the agent or on an agent.get (Herdr 0.9; its CLI waits by calling agent.get).
// omp, whose state comes from its hooks, goes idle only once, during the
// 3 s delay Herdr imposes: without another call, it would refuse every message
// until its first turn typed in the terminal. On that refusal, agent.get does
// the re-check and we resend once; still too early (less than 3 s), the
// original refusal goes back to the caller.
export async function agentPrompt(target: string, text: string): Promise<void> {
  try {
    await herdr('agent.prompt', { target, text })
  } catch (e) {
    if (!(e instanceof HerdrError) || e.code !== 'agent_not_ready') throw e
    try { await herdr('agent.get', { target }) }
    catch { throw e }
    await herdr('agent.prompt', { target, text })
  }
}

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
