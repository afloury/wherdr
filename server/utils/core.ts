import { createConnection } from 'node:net'

// First usable milestone (A–D2). Later file/document features negotiate separately.
export const CORE_METHODS = ['hello', 'rpc.discover', 'terminal.list', 'terminal.get',
  'machine.list', 'terminal.run', 'terminal.read', 'terminal.attach', 'terminal.send',
  'terminal.keys', 'terminal.interrupt', 'terminal.kill', 'events.subscribe'] as const
export class CoreError extends Error {
  constructor(public kind: string, message: string, public hint?: string) { super(message) }
}
const MAX_REPLY = 16 * 1024 * 1024

// A bounded, one-shot connection: no mutation retries, leaked listeners or idle sockets.
// Endpoint comes exclusively from server configuration. Never expose an arbitrary RPC route.
export async function coreCall<T>(endpoint: string, method: string, params = {}, timeout = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(endpoint)
    const chunks: Buffer[] = []
    let bytes = 0
    let settled = false
    const finish = (error?: CoreError, value?: T) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      if (error) reject(error)
      else resolve(value as T)
    }
    const timer = setTimeout(() => finish(new CoreError('timeout', 'herdr-core did not respond in time')), timeout)
    socket.once('connect', () => socket.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) + '\n'))
    socket.once('error', () => finish(new CoreError('unavailable', 'Cannot connect to herdr-core. Check HC_SOCKET and start hc.')))
    socket.once('close', () => finish(new CoreError('disconnected', 'herdr-core closed the connection before replying')))
    socket.on('data', chunk => {
      const end = chunk.indexOf(10)
      const part = end < 0 ? chunk : chunk.subarray(0, end)
      bytes += part.length
      if (bytes > MAX_REPLY) return finish(new CoreError('protocol', 'herdr-core reply is too large'))
      chunks.push(part)
      if (end < 0) return
      try {
        const reply = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (reply.jsonrpc !== '2.0' || reply.id !== 1 || ('error' in reply) === ('result' in reply)) throw new Error()
        if ('error' in reply) {
          const e = reply.error
          if (!e || typeof e.code !== 'number' || typeof e.message !== 'string') throw new Error()
          return finish(new CoreError(e.data?.kind || 'rpc', e.data?.kind === 'unsupported_generation' ? 'Incompatible herdr-core. Protocol generation 1 is required.' : 'herdr-core rejected the request', e.data?.hint))
        }
        finish(undefined, reply.result)
      } catch { finish(new CoreError('protocol', 'Invalid JSON-RPC response from herdr-core')) }
    })
  })
}

interface Hello { generation: number; version: string; framed: boolean; methods: string[]; features: string[] }
export async function checkCore(endpoint: string) {
  const hello = await coreCall<Hello>(endpoint, 'hello', { generation: 1, framed: false })
  if (hello?.generation !== 1 || hello.framed !== false || typeof hello.version !== 'string'
    || !Array.isArray(hello.methods) || !Array.isArray(hello.features)) {
    throw new CoreError('incompatible', 'Incompatible herdr-core. Protocol generation 1 is required.')
  }
  const schema = await coreCall<{ methods: { name: string }[] }>(endpoint, 'rpc.discover')
  if (!Array.isArray(schema?.methods)) throw new CoreError('protocol', 'Invalid herdr-core capability document')
  const missing = CORE_METHODS.filter(name => !hello.methods.includes(name) || !schema.methods.some(m => m?.name === name))
  if (missing.length) throw new CoreError('incompatible', 'herdr-core is missing required capabilities', missing.join(', '))
  return { version: hello.version, generation: hello.generation }
}
