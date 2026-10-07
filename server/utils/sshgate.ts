// Session budget of one multiplexed SSH connection.
//
// sshd caps the sessions a single connection may carry (`MaxSessions`, 10 by
// default). Every terminal, live mirror and remote file read of a machine is
// one session on its shared master connection: past the cap, sshd answers
// "Session open refused by peer", and the ssh client, finding no master to
// fall back on (ProxyCommand=/bin/false), prints "Connection closed by
// UNKNOWN port 65535".
//
// The gate keeps short commands (reads, probes) below the cap, leaving room
// for long-lived streams (terminals, mirrors), which are counted but never
// queued: they follow a user's action. A refused command is retried after a
// short delay; identical read-only commands already running are shared.

// sshd's default MaxSessions.
export const SSH_MAX_SESSIONS = 10
// Sessions left free for a new terminal or mirror.
export const STREAM_MARGIN = 2
// Short commands at once, even with no stream open.
export const EXEC_MAX = 6
export const RETRY_DELAYS_MS = [250, 750, 1500]

const REFUSED_RE = /session open refused|session request failed|administratively prohibited|connection closed by unknown port 65535/i
export const isRefused = (stderr: string) => REFUSED_RE.test(stderr)

export interface GateStats { execs: number, streams: number, queued: number, peak: number, refusals: number }

export class SessionGate {
  private execs = 0
  private streams = 0
  private peak = 0
  private refusals = 0
  private readonly waiting: (() => void)[] = []
  private readonly inflight = new Map<string, Promise<unknown>>()

  constructor(
    private readonly opts: { max?: number, retryDelays?: number[], onRefused?: (s: GateStats, attempt: number) => void } = {},
  ) {}

  // Short commands allowed at once with the streams currently open.
  capacity() {
    return Math.max(1, Math.min(EXEC_MAX, (this.opts.max ?? SSH_MAX_SESSIONS) - STREAM_MARGIN - this.streams))
  }

  stats(): GateStats {
    return { execs: this.execs, streams: this.streams, queued: this.waiting.length, peak: this.peak, refusals: this.refusals }
  }

  // A long-lived session (terminal, mirror) opens; call the result when it closes.
  openStream(): () => void {
    this.streams++
    this.track()
    let open = true
    return () => {
      if (!open) return
      open = false
      this.streams--
      this.wake()
    }
  }

  // Runs a short command under the budget; `refused` tells a refused session
  // apart from the command's own failure. `key` shares a running identical call.
  run<T>(fn: () => Promise<T>, refused: (r: T) => boolean, key?: string): Promise<T> {
    if (key) {
      const same = this.inflight.get(key) as Promise<T> | undefined
      if (same) return same
    }
    const p = this.attempt(fn, refused)
    if (key) {
      this.inflight.set(key, p)
      const drop = () => { if (this.inflight.get(key) === p) this.inflight.delete(key) }
      p.then(drop, drop)
    }
    return p
  }

  private async attempt<T>(fn: () => Promise<T>, refused: (r: T) => boolean): Promise<T> {
    const delays = this.opts.retryDelays ?? RETRY_DELAYS_MS
    for (let i = 0; ; i++) {
      await this.acquire()
      let r: T
      try { r = await fn() }
      finally {
        this.execs--
        this.wake()
      }
      if (!refused(r)) return r
      this.refusals++
      this.opts.onRefused?.(this.stats(), i + 1)
      if (i >= delays.length) return r
      const { promise: pause, resolve } = Promise.withResolvers<void>()
      setTimeout(resolve, delays[i])
      await pause
    }
  }

  private acquire(): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>()
    const take = () => {
      this.execs++
      this.track()
      resolve()
    }
    if (this.execs < this.capacity()) take()
    else this.waiting.push(take)
    return promise
  }

  private wake() {
    while (this.waiting.length && this.execs < this.capacity()) this.waiting.shift()!()
  }

  private track() {
    this.peak = Math.max(this.peak, this.execs + this.streams)
  }
}
