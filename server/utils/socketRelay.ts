// Local Unix sockets backed by Herdr's native SSH stdio bridges. Each accepted
// connection owns one SSH channel; bytes (including endpoint frames) stay raw.
import net from 'node:net'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { shq } from './fsx'

export const socketTransport = (remote: string) =>
  remote.startsWith('/') && !/[\\:]/.test(remote) ? 'forward' : 'relay'

export function bridgeCommand(bin: string, session: string, client = false, check = false) {
  return `exec ${[bin, '--session', session, client ? 'remote-client-bridge' : 'remote-api-bridge', ...(check ? ['--check'] : [])].map(shq).join(' ')}`
}

export class SocketRelay {
  private sockets = new Set<net.Socket>()
  private children = new Set<ChildProcessWithoutNullStreams>()
  private stopped = false
  private server: net.Server

  constructor(private spawn: () => ChildProcessWithoutNullStreams,
    private schedule: (run: () => Promise<void>) => Promise<void> = run => run()) {
    this.server = net.createServer((socket) => {
      this.sockets.add(socket)
      socket.on('error', () => socket.destroy())
      socket.once('close', () => this.sockets.delete(socket))
      void this.schedule(() => this.connect(socket)).catch(() => socket.destroy())
    })
  }

  listen(path: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(path, () => {
        this.server.removeListener('error', reject)
        // Runtime listener errors close this transport; callers reconnect on failed polls.
        this.server.on('error', () => this.stop())
        resolve()
      })
    })
  }

  private connect(socket: net.Socket): Promise<void> {
    if (this.stopped || socket.destroyed) return Promise.resolve()
    return new Promise((resolve) => {
      const child = this.spawn()
      this.children.add(child)
      const finish = () => {
        this.children.delete(child)
        socket.destroy()
        resolve()
      }
      socket.once('close', () => { if (child.exitCode === null) child.kill('SIGTERM') })
      child.on('error', finish)
      child.once('close', finish)
      child.stdin.on('error', () => socket.destroy())
      child.stderr.resume()
      socket.pipe(child.stdin)
      child.stdout.pipe(socket)
    })
  }

  stop() {
    if (this.stopped) return
    this.stopped = true
    this.server.close()
    for (const socket of this.sockets) socket.destroy()
    for (const child of this.children) child.kill('SIGTERM')
  }
}
