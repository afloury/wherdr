// Request bodies are read with a byte limit (server/utils/http.ts): a chunked
// body without Content-Length cannot make the server buffer past it.
import { mkdtempSync, rmSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { createApp, toNodeListener } from 'h3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const data = mkdtempSync(path.join(tmpdir(), 'wherdr-body-'))
process.env.DATA_DIR = data
let server: http.Server
let base = ''
let received = 0
beforeAll(async () => {
  const { defineApi } = await import('../server/utils/http')
  const app = createApp()
  app.use('/json', defineApi((_e, body) => ({ got: body })))
  app.use('/upload', defineApi((_e, b) => { received = b.data.length; return { size: b.data.length } }, { raw: /^application\/octet-stream$/, max: 1024 * 1024, tooLarge: 'File too large' }))
  server = http.createServer(toNodeListener(app))
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  base = `127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(async () => {
  await new Promise(r => server.close(r))
  rmSync(data, { recursive: true, force: true })
})

// A POST sent in chunks (no Content-Length); resolves with the answer, or the
// socket error when the server cut it.
function post(route: string, type: string, chunks: number, size: number): Promise<{ status: number, body: Record<string, unknown> } | { error: string }> {
  return new Promise((resolve) => {
    const req = http.request(`http://${base}${route}`, {
      method: 'POST',
      headers: { 'content-type': type, 'origin': `http://${base}`, 'host': base, 'transfer-encoding': 'chunked' },
    }, (res) => {
      let text = ''
      res.on('data', (c) => { text += c })
      res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(text) }))
    })
    req.on('error', e => resolve({ error: (e as NodeJS.ErrnoException).code || e.message }))
    let i = 0
    const write = () => {
      while (i < chunks) {
        i++
        if (!req.write(Buffer.alloc(size, 0x20))) return void req.once('drain', write)
      }
      req.end()
    }
    write()
  })
}

describe('request body limit', () => {
  it('stops reading as soon as the limit is passed, without waiting for the end', async () => {
    const { readBodyLimited } = await import('../server/utils/http')
    const req = Object.assign(new PassThrough(), { headers: {} }) as unknown as http.IncomingMessage
    const read = readBodyLimited(req, 1000)
    ;(req as unknown as PassThrough).write(Buffer.alloc(600))
    ;(req as unknown as PassThrough).write(Buffer.alloc(600))
    // The sender never finishes: the answer comes anyway.
    await expect(read).resolves.toBeNull()
  })

  it('refuses a declared Content-Length past the limit before reading', async () => {
    const { readBodyLimited } = await import('../server/utils/http')
    const req = Object.assign(new PassThrough(), { headers: { 'content-length': '5000' } }) as unknown as http.IncomingMessage
    await expect(readBodyLimited(req, 1000)).resolves.toBeNull()
  })

  it('accepts a chunked upload under the limit', async () => {
    expect(await post('/upload', 'application/octet-stream', 4, 64 * 1024)).toEqual({ status: 200, body: { size: 256 * 1024 } })
    expect(received).toBe(256 * 1024)
  })

  it('refuses a chunked upload past the limit without buffering it', async () => {
    received = 0
    const r = await post('/upload', 'application/octet-stream', 64, 64 * 1024)
    // The answer arrives, or the server closed the socket while the client was still sending.
    if ('status' in r) expect(r).toEqual({ status: 400, body: { error: 'File too large', code: 'too_large' } })
    else expect(r.error).toMatch(/EPIPE|ECONNRESET/)
    expect(received).toBe(0)
  })

  it('refuses a chunked JSON body past 256 KB', async () => {
    const r = await post('/json', 'application/json', 8, 64 * 1024)
    if ('status' in r) expect(r).toMatchObject({ status: 400, body: { code: 'too_large' } })
    else expect(r.error).toMatch(/EPIPE|ECONNRESET/)
  })

  it('still reads a small JSON body', async () => {
    const r = await new Promise<{ status: number, text: string }>((resolve) => {
      const req = http.request(`http://${base}/json`, { method: 'POST', headers: { 'content-type': 'application/json', 'origin': `http://${base}` } }, (res) => {
        let text = ''
        res.on('data', (c) => { text += c })
        res.on('end', () => resolve({ status: res.statusCode!, text }))
      })
      req.end('{"a":1}')
    })
    expect(r).toEqual({ status: 200, text: '{"got":{"a":1}}' })
  })
})
