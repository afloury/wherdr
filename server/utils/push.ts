// Web Push (iOS 16.4+, installed PWA): the notification is delivered by Apple, so it
// arrives even if Tailscale is off on the phone, and a tap reopens the PWA
// itself (an ntfy notification would open Safari).
import fs from 'node:fs'
import path from 'node:path'
import webpush from 'web-push'
import { APP_URL, DATA_DIR, log } from './env'
import { pushConfig } from './pushConfig'
import { shouldNotify, type NotifyScope } from './notificationPolicy'
import type { Pane } from '../../shared/types'
import { type Quiet, quietActive, silenced } from '../../shared/quiet'

const fsp = fs.promises
const VAPID_FILE = path.join(DATA_DIR, 'vapid.json')
const SUBS_FILE = path.join(DATA_DIR, 'push.json')
const QUIET_FILE = path.join(DATA_DIR, 'quiet.json')

export interface PushSub {
  endpoint: string
  keys: { p256dh: string, auth: string }
  lang: 'en' | 'fr'
  addedAt: string
  notifyScope?: NotifyScope
  sessions?: Record<string, string>
  quiet?: Quiet // mode silence de cet appareil
}
export interface PushPayload {
  title: string
  titleEn?: string
  body: string
  bodyEn?: string
  tag: string
  url: string
  badge?: number
}

let vapid: { publicKey: string, privateKey: string } | null = null

export function initVapid() {
  vapid = null
  const config = pushConfig(APP_URL)
  if (!config.enabled) {
    log(`WARNING: APP_URL is not a valid HTTPS URL; Web Push is disabled (fallback VAPID subject: ${config.subject}). Set a private HTTPS URL for notifications.`)
    return
  }
  try {
    vapid = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'))
  } catch {
    vapid = webpush.generateVAPIDKeys()
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(VAPID_FILE, JSON.stringify(vapid, null, 2) + '\n', { mode: 0o600 })
    log('VAPID keys generated')
  }
  try {
    webpush.setVapidDetails(config.subject, vapid!.publicKey, vapid!.privateKey)
  } catch (error) {
    vapid = null
    log(`WARNING: VAPID subject rejected; Web Push is disabled (${String(error)}).`)
  }
}
export const pushReady = () => Boolean(vapid)
export const vapidPublicKey = () => (vapid ? vapid.publicKey : null)

export async function readSubs(): Promise<PushSub[]> {
  try {
    const raw = JSON.parse(await fsp.readFile(SUBS_FILE, 'utf8'))
    return Array.isArray(raw.subs) ? raw.subs : []
  } catch { return [] }
}
export async function writeSubs(subs: PushSub[]) {
  await fsp.mkdir(DATA_DIR, { recursive: true })
  await fsp.writeFile(SUBS_FILE, JSON.stringify({ subs }, null, 2) + '\n', { mode: 0o600 })
}

// `audience`: the pane concerned (each device's "Notify for" setting),
// or directly the filter to apply to the setting.
export type PushAudience = Pick<Pane, 'name' | 'cwd'> | ((scope: NotifyScope | undefined, sub: PushSub) => boolean)

export function subWatchesSession(sub: PushSub, baseKey: string, session: string, baseSession: string): boolean {
  return (sub.sessions?.[baseKey] || baseSession) === session
}

// Quiet mode for all devices (DATA_DIR/quiet.json, kept across restarts).
export async function readGlobalQuiet(): Promise<Quiet | null> {
  try {
    const q = JSON.parse(await fsp.readFile(QUIET_FILE, 'utf8')).quiet
    return q && (q.until === null || typeof q.until === 'number') && quietActive(q) ? { until: q.until } : null
  } catch { return null }
}
export async function writeGlobalQuiet(quiet: Quiet | null) {
  await fsp.mkdir(DATA_DIR, { recursive: true })
  await fsp.writeFile(QUIET_FILE, JSON.stringify({ quiet }, null, 2) + '\n', { mode: 0o600 })
}

// `force`: the test notification goes through despite quiet mode (explicit gesture).
export async function pushSend(payload: PushPayload, audience?: PushAudience, force = false): Promise<number> {
  if (!pushReady()) return 0
  const subs = await readSubs()
  const globalQuiet = force ? null : await readGlobalQuiet()
  const dead: string[] = []
  let ok = 0
  for (const sub of subs) {
    // Filter before sending: nothing goes to a muted device.
    if (!force && silenced(globalQuiet, sub.quiet)) continue
    if (typeof audience === 'function' ? !audience(sub.notifyScope, sub) : audience && !shouldNotify(sub.notifyScope, audience)) continue
    try {
      const { titleEn, bodyEn, ...message } = payload
      if (sub.lang === 'en') {
        message.title = titleEn || message.title
        message.body = bodyEn || message.body
      }
      await webpush.sendNotification(sub, JSON.stringify(message), { TTL: 3600, urgency: 'high' })
      ok++
    } catch (e) {
      const err = e as { statusCode?: number, body?: string, message?: string }
      const code = err.statusCode || 0
      if (code === 404 || code === 410) dead.push(sub.endpoint)
      log(`push ${code}: ${String(err.body || err.message).slice(0, 140)}`)
    }
  }
  // Re-read before writing: sending took time, and a subscription or
  // quiet setting saved in the meantime must not be overwritten by the old list.
  if (dead.length) await writeSubs((await readSubs()).filter(s => !dead.includes(s.endpoint)))
  return ok
}
