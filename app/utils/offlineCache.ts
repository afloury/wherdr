// Data readable offline, and shown at once when a view opens while the network
// catches up. The service worker never stores the APIs.
// IndexedDB, one record each: the home state, the quotas, the Board, and every
// conversation kept (`chats`, keyed by pane), with a small index of the
// conversations (`index`: when each was used, its size) to bound the whole.
// Opening a conversation reads its record only. Writes are grouped: what changes
// waits in memory and goes in one transaction at most every WRITE_MS (and at
// once when the page is hidden); reads see what waits.
import type { ChatItem, HerdrState, Quotas } from '#shared/types'
import type { TasksBoard } from '#shared/projectsTasks'
import { splitId, LOCAL } from '../../shared/ids'

export const MAX_MESSAGES = 160
export const MAX_CHATS = 12
export const MAX_BYTES = 4 * 1024 * 1024
export const CHAT_BYTES = 220 * 1024
export const LEASE_MS = 12 * 3600 * 1000
export const WRITE_MS = 2000

export interface SavedChat { id: string, items: ChatItem[], at: number }
export interface SavedHome { state: HerdrState, quotas: Quotas | null, at: number }
export interface SavedBoard { board: TasksBoard, at: number }
// One kept conversation: when it was last opened (`used`) and its size in bytes.
export interface ChatEntry { id: string, used: number, bytes: number }

const bytesOf = (v: unknown) => JSON.stringify(v).length * 2

// The end of a conversation, bounded in messages and in bytes.
export function trimChat(items: ChatItem[]): { items: ChatItem[], bytes: number } {
  const out = items.slice(-MAX_MESSAGES)
  const sizes = out.map(bytesOf)
  let total = sizes.reduce((a, b) => a + b, 0)
  let from = 0
  while (from < out.length && total > CHAT_BYTES) total -= sizes[from++]!
  return { items: from ? out.slice(from) : out, bytes: total }
}

// Which conversations to keep: those of panes still open (a pane of a machine
// that does not answer now is kept: it may still be there), the most recently
// used first, at most MAX_CHATS and MAX_BYTES with the other records.
export function pruneIndex(index: ChatEntry[], state: HerdrState | null | undefined, otherBytes: number): { keep: ChatEntry[], drop: string[] } {
  let keep = index.slice()
  if (state?.ok) {
    const alive = new Set(state.panes.map(p => p.id))
    const online = new Set([LOCAL, ...(state.machines || []).filter(m => m.status === 'online').map(m => m.key)])
    keep = keep.filter(c => alive.has(c.id) || !online.has(splitId(c.id).machine))
  }
  keep = keep.sort((a, b) => b.used - a.used).slice(0, MAX_CHATS)
  let total = otherBytes + keep.reduce((a, c) => a + c.bytes, 0)
  while (keep.length && total > MAX_BYTES) total -= keep.pop()!.bytes
  const kept = new Set(keep.map(c => c.id))
  return { keep, drop: index.filter(c => !kept.has(c.id)).map(c => c.id) }
}

// ------------------------------------------------------------ IndexedDB
const DB = 'wherdr-offline'
let dbPromise: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 2)
    const timeout = setTimeout(() => reject(new Error('IndexedDB unavailable')), 3000)
    r.onupgradeneeded = (e) => {
      const d = r.result
      d.createObjectStore('kv')
      d.createObjectStore('chats')
      // Version 1 kept everything in one record: its home state and conversations move over.
      if (e.oldVersion === 1 && d.objectStoreNames.contains('snapshot')) {
        const tx = r.transaction!
        const get = tx.objectStore('snapshot').get('current')
        get.onsuccess = () => {
          const old = get.result
          const kv = tx.objectStore('kv')
          if (old?.home?.state) {
            kv.put({ state: old.home.state, at: old.home.at }, 'home')
            if (old.home.quotas) kv.put(old.home.quotas, 'quotas')
          }
          const index: ChatEntry[] = []
          for (const c of Array.isArray(old?.chats) ? old.chats : []) {
            if (typeof c?.id !== 'string' || !Array.isArray(c.items)) continue
            tx.objectStore('chats').put({ id: c.id, items: c.items, at: c.at }, c.id)
            index.push({ id: c.id, used: c.used || c.at || 0, bytes: bytesOf(c.items) })
          }
          kv.put(index, 'index')
          d.deleteObjectStore('snapshot')
        }
      }
    }
    r.onsuccess = () => { clearTimeout(timeout); resolve(r.result) }
    r.onerror = () => { clearTimeout(timeout); reject(r.error) }
    r.onblocked = () => { clearTimeout(timeout); reject(new Error('IndexedDB blocked')) }
  })
  return dbPromise.catch((e) => { dbPromise = null; throw e })
}
function get<T>(store: 'kv' | 'chats', key: string): Promise<T | undefined> {
  return db().then(d => new Promise<T | undefined>((resolve, reject) => {
    const r = d.transaction(store).objectStore(store).get(key)
    r.onsuccess = () => resolve(r.result as T | undefined)
    r.onerror = () => reject(r.error)
  })).catch(() => undefined)
}

// ------------------------------------------------------------ waiting writes
interface Pending {
  home?: { state: HerdrState, at: number }
  quotas?: Quotas
  board?: SavedBoard
  chats: Map<string, { chat: SavedChat, bytes: number }>
  used: Map<string, number>
  prune?: HerdrState
}
const none = (): Pending => ({ chats: new Map(), used: new Map() })
let pending = none()
let timer: ReturnType<typeof setTimeout> | null = null
let writing: Promise<void> = Promise.resolve()
// Index and size of the other records, as last written (null: not read yet).
let index: ChatEntry[] | null = null
let otherBytes = 0

function schedule() {
  if (timer) return
  timer = setTimeout(flushOffline, WRITE_MS)
}
// Writes what waits, in one transaction. Also called when the page is hidden.
export function flushOffline(): Promise<void> {
  if (timer) { clearTimeout(timer); timer = null }
  const p = pending
  pending = none()
  if (!p.home && !p.quotas && !p.board && !p.chats.size && !p.used.size && !p.prune) return writing
  writing = writing.then(() => write(p)).catch(() => {})
  return writing
}
async function write(p: Pending) {
  try {
    const d = await db()
    if (!index) index = (await get<ChatEntry[]>('kv', 'index')) || []
    if (p.home) otherBytes = bytesOf(p.home)
    let next = index.slice()
    for (const [id, c] of p.chats) next = [{ id, used: p.used.get(id) || Date.now(), bytes: c.bytes }, ...next.filter(e => e.id !== id)]
    for (const [id, used] of p.used) if (!p.chats.has(id)) next = next.map(e => (e.id === id ? { ...e, used } : e))
    const { keep, drop } = pruneIndex(next, p.prune, otherBytes)
    await new Promise<void>((resolve, reject) => {
      const tx = d.transaction(['kv', 'chats'], 'readwrite')
      const kv = tx.objectStore('kv')
      const chats = tx.objectStore('chats')
      if (p.home) kv.put(p.home, 'home')
      if (p.quotas) kv.put(p.quotas, 'quotas')
      if (p.board) kv.put(p.board, 'board')
      for (const [id, c] of p.chats) if (!drop.includes(id)) chats.put(c.chat, id)
      for (const id of drop) chats.delete(id)
      kv.put(keep, 'index')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
    index = keep
  } catch { /* quota, private browsing, eviction: live reading kept */ }
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushOffline() })
  window.addEventListener('pagehide', () => { flushOffline() })
}

// ------------------------------------------------------------ API
export async function readHome(): Promise<SavedHome | null> {
  const [home, quotas] = await Promise.all([
    pending.home ? Promise.resolve(pending.home) : get<{ state: HerdrState, at: number }>('kv', 'home'),
    pending.quotas ? Promise.resolve(pending.quotas) : get<Quotas>('kv', 'quotas'),
  ])
  if (!home?.state || !Array.isArray(home.state.panes) || !Array.isArray(home.state.workspaces)) return null
  return { state: home.state, quotas: quotas || null, at: home.at }
}
export async function readQuotas(): Promise<Quotas | null> {
  return pending.quotas || (await get<Quotas>('kv', 'quotas')) || null
}
export async function readChat(id: string): Promise<SavedChat | null> {
  const c = pending.chats.get(id)?.chat || await get<SavedChat>('chats', id)
  return c && Array.isArray(c.items) && Number.isFinite(c.at) ? c : null
}
export async function readBoard(): Promise<SavedBoard | null> {
  const b = pending.board || await get<SavedBoard>('kv', 'board')
  return b && Array.isArray(b.board?.machines) && Number.isFinite(b.at) ? b : null
}
export function saveHome(state: HerdrState, quotas?: Quotas | null) {
  pending.home = { state, at: Date.now() }
  if (quotas) pending.quotas = quotas
  // Closed panes leave the conversations kept.
  pending.prune = state
  schedule()
}
export function saveQuotas(quotas: Quotas) {
  pending.quotas = quotas
  schedule()
}
export function saveBoard(board: TasksBoard) {
  pending.board = { board, at: Date.now() }
  schedule()
}
export function saveChat(id: string, items: ChatItem[]) {
  const t = trimChat(items)
  pending.chats.set(id, { chat: { id, items: t.items, at: Date.now() }, bytes: t.bytes })
  pending.used.set(id, Date.now())
  schedule()
}
export function touchChat(id: string) {
  pending.used.set(id, Date.now())
  schedule()
}
export async function clearOffline() {
  if (timer) { clearTimeout(timer); timer = null }
  pending = none()
  index = []
  otherBytes = 0
  writing = writing.then(async () => {
    try {
      const d = await db()
      await new Promise<void>((resolve, reject) => {
        const tx = d.transaction(['kv', 'chats'], 'readwrite')
        tx.objectStore('kv').clear()
        tx.objectStore('chats').clear()
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    } catch { /* nothing kept to clear */ }
  })
  return writing
}
