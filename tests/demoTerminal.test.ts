// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installDemoNetwork } from '../app/demo/shim'
import { DEV_SERVER } from '../app/demo/scenario'
import { agentScreen } from '../app/demo/terminal'
import type { Pane } from '../shared/types'

const realFetch = window.fetch
const realSocket = window.WebSocket
const sockets: WebSocket[] = []

beforeEach(() => {
  vi.useFakeTimers()
  installDemoNetwork('/demo/')
})
afterEach(() => {
  for (const socket of sockets.splice(0)) socket.close()
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  window.fetch = realFetch
  window.WebSocket = realSocket
})

async function connect(route: string) {
  const socket = new window.WebSocket(`ws://localhost/ws/${route}`)
  sockets.push(socket)
  const frames: { type: string, width?: number, height?: number, cols?: number, rows?: number }[] = []
  socket.onmessage = e => frames.push(JSON.parse(e.data))
  await vi.advanceTimersByTimeAsync(25)
  return { socket, frames }
}

describe('demo terminal Markdown', () => {
  const pane = { agent: 'claude', status: 'idle', model: { label: 'Sonnet' } } as Pane
  const text = 'Three choices:\n\n| Choice | Behaviour |\n|---|---|\n| System | follows `prefers-color-scheme`, live |\n| Dark | **always** dark |\n\nSaved.'
  const lines = (cols: number) => agentScreen(pane, [{ role: 'assistant', text, ts: null }], '', cols, 60)
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').split('\r\n')

  it('draws a table as a grid, without the Markdown bars and marks', () => {
    const out = lines(100)
    expect(out.slice(3, 10)).toEqual([
      '  ┌────────┬────────────────────────────────────┐',
      '  │ Choice │ Behaviour                          │',
      '  ├────────┼────────────────────────────────────┤',
      '  │ System │ follows prefers-color-scheme, live │',
      '  ├────────┼────────────────────────────────────┤',
      '  │ Dark   │ always dark                        │',
      '  └────────┴────────────────────────────────────┘',
    ])
    expect(out.join('\n')).not.toMatch(/\|/)
    expect(out).toContain('  Saved.')
  })

  it('wraps the cells of a table wider than the screen', () => {
    const out = lines(40)
    const grid = out.filter(l => /[│┌├└]/.test(l))
    expect(grid.length).toBeGreaterThan(7)
    for (const l of grid) expect(l.length).toBeLessThanOrEqual(40)
    expect(new Set(grid.map(l => l.length)).size).toBe(1)
    // Nothing is dropped: a word longer than its column is cut over two rows.
    expect(grid.join('').replace(/[^a-z,-]/g, '')).toContain('followsprefers-color-scheme,live')
  })
})

describe('demo split terminal sizing', () => {
  it('places a short Claude exchange at the top with its prompt directly after it', () => {
    const pane = { agent: 'claude', status: 'idle', model: { label: 'Sonnet' } } as Pane
    const screen = agentScreen(pane, [{ role: 'assistant', text: 'Done.', ts: null }], '', 100, 80)
    expect(screen).toContain('\x1b[H\r\n')
    expect(screen.split('\r\n')).toHaveLength(8)
    expect(screen).toContain('\x1b[6;3H')
  })
  it('fits the active terminal, keeps its size in a mirror, and follows cell resizing', async () => {
    const { socket, frames } = await connect(`term?pane=${DEV_SERVER}&cols=113&rows=62`)
    expect(frames.at(-1)).toMatchObject({ type: 'terminal.frame', width: 113, height: 62 })
    socket.send(JSON.stringify({ type: 'terminal.resize', cols: 81, rows: 48 }))
    expect(frames.at(-1)).toMatchObject({ width: 81, height: 48 })
    socket.close()

    const mirror = await connect(`mirror?pane=${DEV_SERVER}&hold=1`)
    expect(mirror.frames[0]).toEqual({ type: 'mirror.size', cols: 81, rows: 48 })
    mirror.socket.send(JSON.stringify({ type: 'fit', cols: 65, rows: 40 }))
    expect(mirror.frames.at(-1)).toMatchObject({ width: 65, height: 40 })
    // A mirror remains read only.
    const n = mirror.frames.length
    mirror.socket.send(JSON.stringify({ type: 'terminal.input', text: 'ls\r' }))
    expect(mirror.frames).toHaveLength(n)
  })

  it('does not fit an unheld mirror', async () => {
    const mirror = await connect(`mirror?pane=${DEV_SERVER}`)
    const n = mirror.frames.length
    mirror.socket.send(JSON.stringify({ type: 'fit', cols: 120, rows: 60 }))
    expect(mirror.frames).toHaveLength(n)
  })
})
