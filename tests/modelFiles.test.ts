// /models/**: dictation files from DATA_DIR/models, in Range slices, never
// anything outside that folder.
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { modelMime, serveModelFile } from '../server/utils/modelFiles'

let root = ''
const body = Buffer.from('0123456789')
beforeAll(() => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hw-models-'))
  root = path.join(dir, 'models')
  mkdirSync(path.join(root, 'runtime'), { recursive: true })
  writeFileSync(path.join(root, 'runtime', 'engine.wasm'), body)
  writeFileSync(path.join(root, 'runtime', 'engine.js'), 'self.x = 1')
  writeFileSync(path.join(root, 'empty.onnx'), '')
  writeFileSync(path.join(dir, 'auth.json'), '{"secret":1}')
  symlinkSync(path.join(dir, 'auth.json'), path.join(root, 'leak.json'))
})

describe('serveModelFile', () => {
  it('sends the whole file with its exact type', async () => {
    const res = await serveModelFile(root, 'runtime/engine.wasm')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/wasm')
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    expect(res.headers.get('content-length')).toBe('10')
    expect(res.headers.get('cache-control')).toContain('private')
    expect(Buffer.from(await res.arrayBuffer())).toEqual(body)
    expect((await serveModelFile(root, 'runtime/engine.js')).headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    const empty = await serveModelFile(root, 'empty.onnx')
    expect([empty.status, empty.headers.get('content-length'), (await empty.arrayBuffer()).byteLength]).toEqual([200, '0', 0])
  })
  it('sends a slice with 206 and Content-Range', async () => {
    const res = await serveModelFile(root, 'runtime/engine.wasm', { range: 'bytes=3-6' })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 3-6/10')
    expect(res.headers.get('content-length')).toBe('4')
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('3456')
  })
  it('answers 416 with the size to a range past the end', async () => {
    const res = await serveModelFile(root, 'runtime/engine.wasm', { range: 'bytes=10-20' })
    expect(res.status).toBe(416)
    expect(res.headers.get('content-range')).toBe('bytes */10')
  })
  it('answers HEAD with the headers only', async () => {
    const res = await serveModelFile(root, 'runtime/engine.wasm', { method: 'HEAD', range: 'bytes=0-1' })
    expect([res.status, res.headers.get('content-length'), (await res.arrayBuffer()).byteLength]).toEqual([200, '10', 0])
  })
  it('refuses every path outside the models folder, and folders', async () => {
    for (const rel of ['../auth.json', '..%2Fauth.json', 'runtime/../../auth.json', '/etc/passwd', 'leak.json', 'runtime', '', 'missing.onnx', '%E0%A4%A', 'a\0b']) {
      const res = await serveModelFile(root, rel)
      expect(res.status, rel).toBe(404)
      expect(await res.text()).not.toContain('secret')
    }
  })
  it('falls back to a binary type', () => {
    expect(modelMime('model.int8.onnx')).toBe('application/octet-stream')
    expect(modelMime('tokens.txt')).toBe('text/plain; charset=utf-8')
  })
})
