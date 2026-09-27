// Données lisibles hors réseau. Le service worker ne stocke jamais les API.
import type { ChatItem, HerdrState, Quotas } from '#shared/types'
import { splitId, LOCAL } from '../../shared/ids'

export const MAX_MESSAGES = 160
export const MAX_CHATS = 12
export const MAX_BYTES = 4 * 1024 * 1024
export const LEASE_MS = 12 * 3600 * 1000

export interface SavedChat { id: string, items: ChatItem[], at: number, used: number }
export interface SavedHome { state: HerdrState, quotas: Quotas | null, at: number }
export interface Snapshot { home: SavedHome | null, chats: SavedChat[] }
const blank = (): Snapshot => ({ home: null, chats: [] })
const size = (v: unknown) => JSON.stringify(v).length * 2

export function trimChat(items: ChatItem[]): ChatItem[] {
  let out = items.slice(-MAX_MESSAGES)
  while (out.length && size(out) > 220 * 1024) out = out.slice(1)
  return out
}

export function pruneSnapshot(snapshot: Snapshot, state?: HerdrState): Snapshot {
  const s: Snapshot = { home: snapshot.home, chats: snapshot.chats.slice() }
  if (state?.ok) {
    const alive = new Set(state.panes.map(p => p.id))
    const online = new Set([LOCAL, ...(state.machines || []).filter(m => m.status === 'online').map(m => m.key)])
    s.chats = s.chats.filter(c => alive.has(c.id) || !online.has(splitId(c.id).machine))
  }
  s.chats = s.chats.map(c => ({ ...c, items: trimChat(c.items) }))
    .sort((a, b) => b.used - a.used).slice(0, MAX_CHATS)
  while (s.chats.length && size(s) > MAX_BYTES) s.chats.pop()
  if (size(s) > MAX_BYTES) s.home = null
  return s
}

let dbPromise: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const r = indexedDB.open('wherdr-offline', 1)
    const timeout = setTimeout(() => reject(new Error('IndexedDB indisponible')), 3000)
    r.onupgradeneeded = () => r.result.createObjectStore('snapshot')
    r.onsuccess = () => { clearTimeout(timeout); resolve(r.result) }
    r.onerror = () => { clearTimeout(timeout); reject(r.error) }
    r.onblocked = () => { clearTimeout(timeout); reject(new Error('IndexedDB bloqué')) }
  })
  return dbPromise.catch(e => { dbPromise = null; throw e })
}
async function read(): Promise<Snapshot> {
  try {
    const d = await db()
    return await new Promise((resolve, reject) => {
      const r = d.transaction('snapshot').objectStore('snapshot').get('current')
      r.onsuccess = () => {
        const raw = r.result
        if (!raw || !Array.isArray(raw.chats)) return resolve(blank())
        resolve({
          home: raw.home?.state && Array.isArray(raw.home.state.panes) && Array.isArray(raw.home.state.workspaces) ? raw.home : null,
          chats: raw.chats.filter((c: SavedChat) => typeof c?.id === 'string' && Array.isArray(c.items) && Number.isFinite(c.at)),
        })
      }
      r.onerror = () => reject(r.error)
    })
  } catch { return blank() }
}
async function write(s: Snapshot): Promise<void> {
  try {
    const d = await db()
    await new Promise<void>((resolve, reject) => {
      const tx = d.transaction('snapshot', 'readwrite')
      tx.objectStore('snapshot').put(s, 'current')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch { /* quota, navigation privée, éviction : lecture en direct conservée */ }
}
// Sérialisation des écritures : un état et une conversation arrivent souvent ensemble.
let pending = Promise.resolve()
function mutate(fn: (s: Snapshot) => Snapshot) {
  pending = pending.then(async () => write(fn(await read()))).catch(() => {})
  return pending
}
export const readOffline = read
export function saveHome(state: HerdrState, quotas?: Quotas | null) {
  return mutate(s => pruneSnapshot({ ...s, home: { state, quotas: quotas === undefined ? s.home?.quotas || null : quotas, at: Date.now() } }, state))
}
export function saveQuotas(quotas: Quotas) {
  return mutate(s => s.home ? { ...s, home: { ...s.home, quotas } } : s)
}
export function saveChat(id: string, items: ChatItem[]) {
  return mutate(s => pruneSnapshot({ ...s, chats: [
    { id, items: trimChat(items), at: Date.now(), used: Date.now() },
    ...s.chats.filter(c => c.id !== id),
  ] }))
}
export function touchChat(id: string) {
  return mutate(s => pruneSnapshot({ ...s, chats: s.chats.map(c => c.id === id ? { ...c, used: Date.now() } : c) }))
}
export function clearOffline() { return mutate(() => blank()) }
