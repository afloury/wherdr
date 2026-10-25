import type { CoordinatorTarget } from './projectsTasks'

export interface PilotSchedule {
  on: boolean, frequency: string, hours?: string, goal: string, today: string, last: number | string | null, next: number | string | null
}
export interface AutomationSchedule {
  id: string, name: string, on: boolean, trigger: string, repo: string, last: number | null, next: number | null, tasks: string[]
}
export interface SessionTimer { id: string, cron: string, recurring: boolean, next: number | null, prompt: string, created: number }
export interface Scheduled { autopilot: PilotSchedule | null, automations: AutomationSchedule[], timers: SessionTimer[], timezone: string, warnings: string[] }
const obj = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {}
const str = (v: unknown) => typeof v === 'string' ? v.slice(0, 4000) : ''
const at = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
const rows = (s: string): Record<string, any>[] => { const v = JSON.parse(s); if (!Array.isArray(v)) throw new Error('Invalid schedule response'); return v.map(obj) }

export function parseAutopilot(s: string, target: CoordinatorTarget): PilotSchedule | null {
  const key = target.kind === 'project' ? `project:${target.repo}` : target.kind
  const r = rows(s).find(r => r.coordinator === key)
  if (!r) return null
  const settings = Array.isArray(r.settings) ? r.settings.map(obj) : []
  return { on: r.on === true, frequency: str(settings.find(s => s.label === 'Wakes')?.value), hours: str(settings.find(s => s.label === 'Hours')?.value), goal: str(r.goal), today: str(r.today),
    last: at(r.last) || str(r.last) || at(obj(r.wakes?.[0]).at), next: at(r.next) || str(r.next) || null }
}
// timerAt records the previous periodic wake, not the next one. The CLI
// remains authoritative for quiet hours and event-driven wakeups.
export function autopilotNextAt(timerAt: unknown, pilot: PilotSchedule, now = Date.now()): number | null {
  const anchor = at(timerAt)
  const interval = /^every (\d+(?:\.\d+)?)\s*(s|m|h|d)\b/.exec(pilot.frequency)
  if (pilot.hours && pilot.hours !== 'any') return null
  if (!anchor || !interval || typeof pilot.next !== 'string' || !/^next in /.test(pilot.next)) return null
  const scale: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 }
  const next = anchor + Number(interval[1]) * scale[interval[2]!]!
  const stated = /^next in (\d+)(s|m|h|d)\b/.exec(pilot.next)
  if (!stated || Math.floor((next - now) / scale[stated[2]!]!) !== Number(stated[1])) return null
  return next > now ? next : null
}
export function parseAutomations(s: string, target: CoordinatorTarget): AutomationSchedule[] {
  return rows(s).filter(r => target.kind !== 'project' || r.repo === target.repo || /any repo|every repo/.test(str(r.trigger))).map(r => {
    const last = obj(r.last)
    return { id: str(r.id), name: str(r.name), on: r.on === true, trigger: str(r.trigger), repo: str(r.repo), last: at(last.at), next: at(r.next),
      tasks: [str(last.task)].filter(t => /^[\w.-]+\/\d+[a-e]?$/.test(t)) }
  })
}

// Five-field cron, evaluated in the coordinator machine's zone, including DST.
// Session jobs expire after seven days, so searching beyond that is unnecessary.
export function nextCron(cron: string, after: number, timezone = 'UTC'): number | null {
  const fields = cron.trim().split(/\s+/)
  if (fields.length !== 5) return null
  const limits = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]] as const
  const sets = fields.map((field, i) => {
    const [min, max] = limits[i]!
    const set = new Set<number>()
    for (const part of field.split(',')) {
      const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part)
      if (!m) return null
      const step = m[2] ? Number(m[2]) : 1
      const [lo, hi] = m[1] === '*' ? [min, max] : m[1]!.includes('-') ? m[1]!.split('-').map(Number) : [Number(m[1]), m[2] ? max : Number(m[1])]
      if (!step || lo! < min || hi! > max || lo! > hi!) return null
      for (let n = lo!; n <= hi!; n += step) set.add(i === 4 && n === 7 ? 0 : n)
    }
    return set
  })
  if (sets.some(s => !s)) return null
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, minute: 'numeric', hour: 'numeric', hourCycle: 'h23', day: 'numeric', month: 'numeric', weekday: 'short' })
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  for (let t = Math.floor(after / 60000) * 60000 + 60000; t <= after + 7 * 86400000; t += 60000) {
    const p = Object.fromEntries(fmt.formatToParts(t).map(p => [p.type, p.value]))
    const dom = sets[2]!.has(Number(p.day)), dow = sets[4]!.has(days.indexOf(p.weekday!))
    const day = fields[2] !== '*' && fields[4] !== '*' ? dom || dow : dom && dow
    if (day && sets[0]!.has(Number(p.minute)) && sets[1]!.has(Number(p.hour)) && sets[3]!.has(Number(p.month))) return t
  }
  return null
}

export const WAKEUP_ID = 'ScheduleWakeup'
export function createTimerReconstruction(now = Date.now(), timezone = 'UTC') {
  const pending = new Map<string, { name: string, input: Record<string, any>, created: number }>()
  const timers = new Map<string, SessionTimer>()
  const seen = new Set<string>()
  function read(lines: Iterable<string>) {
    for (const line of lines) {
      let r: Record<string, any>
      try { r = obj(JSON.parse(line)) } catch { continue }
      const ts = Date.parse(r.timestamp) || 0
      if (r.subtype === 'scheduled_task_fire' || r.scheduledTaskId) {
        const id = str(r.taskId || r.scheduledTaskId)
        if (timers.get(id)?.recurring === false) timers.delete(id)
      }
      const content = obj(r.message).content
      if (!Array.isArray(content)) continue
      for (const raw of content) {
        const b = obj(raw)
        if (b.type === 'tool_use' && ['CronCreate', 'CronDelete', 'ScheduleWakeup'].includes(b.name)) {
          if (!seen.has(b.id)) { pending.set(b.id, { name: b.name, input: obj(b.input), created: ts }); seen.add(b.id) }
        }
        if (b.type !== 'tool_result') continue
        const call = pending.get(b.tool_use_id)
        if (!call) continue
        pending.delete(b.tool_use_id)
        if (b.is_error) continue
        const text = typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map((v: any) => str(obj(v).text)).join('\n') : ''
        let result = obj(b.content)
        try { result = obj(JSON.parse(text)) } catch { /* CLI-style text result */ }
        if (call.name === 'CronDelete') { timers.delete(str(call.input.id || call.input.taskId)); continue }
        if (call.name === 'ScheduleWakeup') { wakeup(call, obj(r.toolUseResult), text); continue }
        const id = str(result.id || result.taskId || result.task_id || result.job_id) || /\bID\s*[:=]?\s*([a-z0-9][\w-]*)/i.exec(text)?.[1] || /(?:\bjob\s+|\btask\s+)([a-z0-9][\w-]*)/i.exec(text)?.[1] || ''
        if (!id || call.created <= 0 || now - call.created >= 7 * 86400000) continue
        const cron = str(call.input.cron || call.input.cron_expression)
        const recurring = call.input.recurring === true || (call.input.recurring !== false && call.name === 'CronCreate')
        const wakeAt = result.nextRunAt || result.next_run_at || call.input.at || call.input.wake_at || call.input.time || call.input.timestamp
        const explicit = at(wakeAt) || (Date.parse(wakeAt || '') || null)
        const first = explicit || (cron ? nextCron(cron, call.created, timezone) : null)
        if (!recurring && first && first <= now) continue
        const next = explicit && explicit > now ? explicit : recurring ? (cron ? nextCron(cron, now, timezone) : null) : first
        timers.set(id, { id, cron, recurring, next, prompt: str(call.input.prompt).replace(/\s+/g, ' ').slice(0, 180), created: call.created })
      }
    }
  }
  // A session holds a single pending wakeup: each call replaces the previous
  // one and `stop: true` cancels it. The call gives only `delaySeconds`; the
  // wake time is in the record's toolUseResult.scheduledFor, else in the text
  // ("Next wakeup scheduled for 08:58:00 (in 1248s)").
  function wakeup(call: { input: Record<string, any>, created: number }, meta: Record<string, any>, text: string) {
    timers.delete(WAKEUP_ID)
    if (call.input.stop === true || call.created <= 0) return
    const seconds = at(meta.clampedDelaySeconds) || Number(/\(in (\d+)s\)/.exec(text)?.[1]) || at(call.input.delaySeconds)
    const next = at(meta.scheduledFor) || (seconds ? call.created + seconds * 1000 : null)
    if (!next) return
    const prompt = str(call.input.prompt) === '<<autonomous-loop-dynamic>>' ? str(call.input.reason) || str(call.input.prompt) : str(call.input.prompt) || str(call.input.reason)
    timers.set(WAKEUP_ID, { id: WAKEUP_ID, cron: '', recurring: false, next, prompt: prompt.replace(/\s+/g, ' ').slice(0, 180), created: call.created })
  }
  function finish(): SessionTimer[] {
    return [...timers.values()].filter(t => now - t.created < 7 * 86400000 && (t.recurring || !t.next || t.next > now))
      .map(t => ({ ...t, next: t.next && t.next < t.created + 7 * 86400000 ? t.next : null }))
  }
  return { read, finish }
}

export function reconstructTimers(transcript: string, now = Date.now(), timezone = 'UTC'): SessionTimer[] {
  const reconstruction = createTimerReconstruction(now, timezone)
  reconstruction.read(transcript.split('\n'))
  return reconstruction.finish()
}
