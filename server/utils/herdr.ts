// Socket API Herdr : JSON par ligne, une connexion par requête.
//   {"id","method","params"}\n -> {"id","result"} ou {"id","error":{code,message}}
// Plusieurs machines : chaque serveur Herdr a son socket (local, ou socket
// distant transféré par SSH, cf. machines.ts). Les appels sont routés d'après
// l'ID du pane / workspace qu'ils visent (préfixe « <machine>~ », cf. shared/ids.ts).
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

// Socket d'une machine (null : injoignable pour l'instant, avec la raison).
export type SocketResolver = (machine: string) => { sock: string | null, error?: string }
let resolveSocket: SocketResolver = m => (m === LOCAL ? { sock: HERDR_SOCK } : { sock: null, error: `machine inconnue : ${m}` })
export function setSocketResolver(fn: SocketResolver) { resolveSocket = fn }

// Appel routé : la machine est celle du pane / workspace visé (locale sinon).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function herdr<T = any>(method: string, params: Record<string, unknown> = {}, timeoutMs = 15000): Promise<T> {
  let routed
  try { routed = routeParams(params) }
  catch (e) { return Promise.reject(new HerdrError('bad_pane', (e as Error).message)) }
  return herdrOn<T>(routed.machine ?? LOCAL, method, routed.params, timeoutMs)
}

// Appel sur une machine donnée (IDs déjà locaux à cette machine).
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
    sock.on('close', () => finish(new HerdrError('closed', 'connexion Herdr fermée sans réponse')))
  })
}

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
