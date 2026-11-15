// In-memory Cache Storage and a /models/** server answering byte ranges, for
// the on-device model store and its Settings list.
import type { DeviceModel } from '../app/utils/dictation/deviceModels'

const keyOf = (r: RequestInfo | URL) => { const u = new URL(typeof r === 'string' || r instanceof URL ? r : r.url, 'http://x'); return u.pathname + u.search }

export function fakeCaches() {
  const stores = new Map<string, Map<string, ArrayBuffer>>()
  const open = async (name: string) => {
    const s = stores.get(name) ?? new Map<string, ArrayBuffer>()
    stores.set(name, s)
    return {
      match: async (r: RequestInfo) => (s.has(keyOf(r)) ? new Response(s.get(keyOf(r))!) : undefined),
      // Only the key counts (sizes come from the catalog): no 600 MB held in tests.
      put: async (r: RequestInfo, res: Response) => { await res.body?.cancel(); s.set(keyOf(r), new ArrayBuffer(0)) },
      keys: async () => [...s.keys()].map(k => ({ url: `http://x${k}` })),
      delete: async (r: RequestInfo) => s.delete(keyOf(r)),
    }
  }
  return { open, stores } as unknown as CacheStorage & { stores: typeof stores }
}

// Serves the model's files as zero bytes of their catalog size; `failAt`
// makes requests from that byte on fail, as a dropped link would.
export function rangeServer(m: DeviceModel, o: { failAt?: number } = {}) {
  const calls: string[] = []
  const fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = keyOf(url)
    const file = m.files.find(f => path === `/models/${m.dir}/${f.path}`)
    if (!file) return new Response(null, { status: 404 })
    const [, a, b] = /bytes=(\d+)-(\d+)/.exec(new Headers(init?.headers).get('range') ?? '')!
    const start = Number(a)
    const end = Math.min(Number(b), file.bytes - 1)
    calls.push(`${file.path} ${start}`)
    if (o.failAt != null && start >= o.failAt) throw new TypeError('network down')
    return new Response(new Uint8Array(end - start + 1), { status: 206, headers: { 'content-range': `bytes ${start}-${end}/${file.bytes}` } })
  }
  return { fetch: fetch as typeof globalThis.fetch, calls }
}
