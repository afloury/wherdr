// `herdr notification show` -> Web Push on the iPhone.
//
// Herdr only publishes these notifications to its shell clients (see
// herdrEndpoint.ts): we keep a passive connection to the client socket of each
// online machine (local: herdr-client.sock next to herdr.sock; remote:
// socket forwarded by the SSH master connection, see machines.ts), and each
// "custom" notification goes out as push, filtered ("Notify for" setting,
// duplicates) by notificationPolicy.ts.
import net from 'node:net'
import crypto from 'node:crypto'
import { NOTICES_ENABLED, log } from './env'
import { type HerdrNotification, FrameSplitter, decodeServerFrame, helloFrame } from './herdrEndpoint'
import { NoticeDeduper, findThreadPane, forwardableNotice, noticeKey, projectThreadOfNotice, shouldNotifyNotice } from './notificationPolicy'
import { type Machine, allMachines, multiMachine, onMachinesChange } from './machines'
import { getState, isViewed } from './state'
import { pushSend, subWatchesSession } from './push'

const BACKOFF_MS = [2000, 5000, 10000, 30000, 60000]
// Server refusing the handshake (incompatible version): we retry rarely.
const REJECTED_RETRY_MS = 10 * 60000

class NoticeListener {
  private sock: net.Socket | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private fails = 0
  private stopped = false
  private path: string | null = null
  private welcomed = false

  constructor(readonly machine: Machine) {}

  // (Re)connects if the socket changed or the connection dropped.
  ensure() {
    if (this.stopped) return
    const p = this.machine.clientSock()
    if (!p) return this.close()
    if (this.sock && this.path === p) return
    if (this.timer) return
    this.close()
    this.connect(p)
  }

  stop() {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.close()
  }

  private close() {
    const s = this.sock
    this.sock = null
    this.path = null
    if (s) s.destroy()
  }

  private retry(delay?: number) {
    if (this.stopped || this.timer) return
    const d = delay ?? BACKOFF_MS[Math.min(this.fails, BACKOFF_MS.length - 1)]!
    this.fails++
    this.timer = setTimeout(() => { this.timer = null; this.ensure() }, d)
  }

  private connect(p: string) {
    const s = net.createConnection(p)
    this.sock = s
    this.path = p
    this.welcomed = false
    const frames = new FrameSplitter()
    let rejected = false
    s.on('connect', () => s.write(helloFrame()))
    s.on('data', (chunk: Buffer) => {
      let list: Buffer[]
      try { list = frames.push(chunk) }
      catch (e) { log(`herdr notifications (${this.name()}): ${(e as Error).message}`); s.destroy(); return }
      for (const f of list) {
        let msg
        try { msg = decodeServerFrame(f) }
        catch { continue } // frame of a type we do not read in full
        if (msg.type === 'control' && msg.kind === 'endpoint.welcome.v1') {
          let err: { message?: string } | null = null
          try { err = JSON.parse(msg.data).error || null } catch { /* nothing */ }
          if (err) {
            rejected = true
            log(`herdr notifications (${this.name()}) refused: ${err.message || 'handshake'}`)
            s.destroy()
            return
          }
          this.welcomed = true
          this.fails = 0
          log(`herdr notifications (${this.name()}): listening`)
        } else if (msg.type === 'notification') {
          onNotice(this.machine, msg.notification).catch(e => log('herdr notification:', (e as Error).message))
        } else if (msg.type === 'shutdown') {
          s.destroy()
        }
      }
    })
    s.on('error', () => {})
    s.on('close', () => {
      if (this.sock !== s) return
      this.sock = null
      this.path = null
      if (this.welcomed) log(`herdr notifications (${this.name()}): connection closed`)
      this.retry(rejected ? REJECTED_RETRY_MS : undefined)
    })
  }

  private name() { return this.machine.local ? 'local' : this.machine.label }
}

const listeners = new Map<Machine, NoticeListener>()
const dedupe = new NoticeDeduper()

async function onNotice(m: Machine, n: HerdrNotification) {
  if (!forwardableNotice(n) || !dedupe.fresh(`${m.key}:${noticeKey(n)}`)) return
  // Notification from a herdr-projects thread: link to its pane if it is unique.
  const thread = projectThreadOfNotice(n.title)
  const panes = getState().panes.filter(p => (p.machine || '') === m.key)
  const pane = thread ? findThreadPane(panes, thread.project, thread.thread) : null
  if (pane && isViewed(pane.id)) return
  const on = multiMachine() ? `${m.label || (m.local ? 'local' : m.key)} · ` : ''
  const title = `${on}${n.title}`
  // One notification per pane (replaces the one for its state), otherwise one per title.
  const tag = pane ? `pane-${pane.id}` : `herdr-${crypto.createHash('sha1').update(`${m.key}\n${n.title}`).digest('hex').slice(0, 12)}`
  const sent = await pushSend(
    { title, body: n.body || '', tag, url: pane ? `/#/a/${encodeURIComponent(pane.id)}` : '/#/' },
    (scope, sub) => shouldNotifyNotice(scope, n.title) &&
      subWatchesSession(sub, m.info().baseKey ?? m.key, m.session,
        allMachines().find(base => base.key === (m.info().baseKey ?? m.key))?.session || 'default'),
  )
  log(`herdr notification "${title}"${pane ? ` (${pane.id})` : ''} -> ${sent} device(s)`)
}

export function syncNoticeListeners() {
  if (!NOTICES_ENABLED) return
  const live = new Set(allMachines())
  for (const [m, l] of listeners) {
    if (!live.has(m)) { l.stop(); listeners.delete(m) }
  }
  for (const m of live) {
    let l = listeners.get(m)
    if (!l) { l = new NoticeListener(m); listeners.set(m, l) }
    l.ensure()
  }
}

let timer: ReturnType<typeof setInterval> | null = null
export function startNotices() {
  if (!NOTICES_ENABLED) return
  onMachinesChange(syncNoticeListeners)
  syncNoticeListeners()
  // Herdr server restarted, machine back online: we reconnect.
  timer = setInterval(syncNoticeListeners, 15000)
}
export function stopNotices() {
  if (timer) clearInterval(timer)
  timer = null
  for (const l of listeners.values()) l.stop()
  listeners.clear()
}
