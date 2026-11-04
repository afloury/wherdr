#!/usr/bin/env node
// Downloads the files of on-device dictation into DATA_DIR/models, where the
// /models/** route serves them: the WASM runtimes under runtime/, the models
// beside them. Every file is pinned (exact URL) and checked against its
// sha256 before it is moved into place. They stay out of the npm package and
// of the service worker precache (docs/installation.md#on-device-dictation-files).
//
//   DATA_DIR=~/.local/share/wherdr node scripts/fetch-dictation-files.mjs [set...]
//
// Sets: runtime (sherpa-onnx WASM, 13 MB), parakeet (Parakeet v3, French,
// English and 23 more, 670 MB), sensevoice (237 MB, no French), ort
// (onnxruntime-web, 59 MB, for WebGPU models only), all. Default: runtime parakeet.
// The models must match app/utils/dictation/deviceModels.ts (a test checks it).
// Run again: files already in place are checked and kept, an interrupted
// download resumes. Based on followcat's scripts/fetch-asr-models.sh (MIT).
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

// sherpa-onnx's combined WASM build with followcat's ASR bindings (his
// branch mobile, commit 679ff70; no official release ships this build).
const SHERPA = 'https://raw.githubusercontent.com/followcat/wherdr/679ff70f98d0a296477776a7d3fb2344a0c8a1d5/public/wasm/'
const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/'
const ASR_MODELS = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/'

// A file: { url, sha256, to } with `to` relative to DATA_DIR/models.
// An archive: { url, sha256, dir, members }, its members extracted into `dir`.
export const SETS = {
  runtime: [
    ['sherpa-onnx-wasm-combined.js', 'c7778951c5ef025d240ecf36d8d642ee2aa089353d4e46187767044547313e57'],
    ['sherpa-onnx-wasm-combined.wasm', 'cc726f48a62ceba05541c195b7155482da7232d9300405fb5a4a7ddce6110705'],
    ['sherpa-onnx-core.js', '7913d88d173bc2140d52085cc9d62bf3c8a9b95e53842704329007fa0e37b879'],
    ['sherpa-onnx-asr.js', 'a83eb0f88258864453e3c910fb1954f8f78c2cca071ebac06329fcfa25c8b88d'],
  ].map(([name, sha256]) => ({ url: SHERPA + name, sha256, to: `runtime/sherpa-onnx-679ff70/${name}` })),
  ort: [
    ['ort.webgpu.min.js', 'c94f5bb9c17bd37168e9b4220facb2b6fc1dd125a5e91b7a680171840a27f254'],
    ['ort.wasm.min.js', 'c6bc9f8e1d0ecc3983a57910e6a30b2230a512bcd2e0207cd64306459c3de7b4'],
    ['ort-wasm-simd-threaded.wasm', '45eaee27761ad883742a8d4b8fce1538d60ce43b51adf1726fafccc59b8c1a15'],
    ['ort-wasm-simd-threaded.jsep.mjs', 'c7b70c8003f077c62849e15275d0b1f1d1cf1a6dfc63b967400567c7224bfdbe'],
    ['ort-wasm-simd-threaded.jsep.wasm', 'ac0d8f1cfbf2732420ad78a86072b8507253c63885a61c3fd640b3055256d31d'],
    ['ort-wasm-simd-threaded.asyncify.mjs', '249b4dc791f081d33bd11760bfd669fe85f97289e679bbeb291b874272125dff'],
    ['ort-wasm-simd-threaded.asyncify.wasm', 'babec0bbddb6d3082623b99b7e1391b75e0729bcca076ff8424d7753af97fada'],
  ].map(([name, sha256]) => ({ url: ORT + name, sha256, to: `runtime/onnxruntime-web-1.23.2/${name}` })),
  parakeet: [{
    url: `${ASR_MODELS}sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2`,
    sha256: '5793d0fd397c5778d2cf2126994d58e9d56b1be7c04d13c7a15bb1b4eafb16bf',
    dir: 'parakeet-tdt-0.6b-v3-int8',
    members: ['encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt'],
  }],
  sensevoice: [{
    url: `${ASR_MODELS}sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09.tar.bz2`,
    sha256: '7305f7905bfcf77fa0b39388a313f3da35c68d971661a65475b56fb2162c8e63',
    dir: 'sensevoice-zh-en-ja-ko-yue-2025-09',
    members: ['model.int8.onnx', 'tokens.txt'],
  }],
}
export const DEFAULT_SETS = ['runtime', 'parakeet']

export async function sha256Of(file) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(file), hash)
  return hash.digest('hex')
}

const exists = file => stat(file).then(s => s.isFile(), () => false)

// url → file, through file.part: resumed with Range when a part is left, then
// moved into place only when its sha256 matches. `fetchImpl` for the tests.
export async function download(url, sha256, file, { fetchImpl = fetch, tries = 5, log = () => {} } = {}) {
  const part = `${file}.part`
  await mkdir(path.dirname(file), { recursive: true })
  for (let attempt = 1; ; attempt++) {
    try {
      const have = await stat(part).then(s => s.size, () => 0)
      const res = await fetchImpl(url, { headers: have ? { range: `bytes=${have}-` } : {}, redirect: 'follow' })
      if (res.status === 416 && have) {
        // The part is already whole (or longer than the file): check it below.
        await res.body?.cancel()
      } else if (res.ok && res.body) {
        const append = have > 0 && res.status === 206
        await pipeline(Readable.fromWeb(res.body), createWriteStream(part, { flags: append ? 'a' : 'w' }))
      } else {
        await res.body?.cancel()
        throw new Error(`HTTP ${res.status}`)
      }
      const got = await sha256Of(part)
      if (got !== sha256) {
        await rm(part, { force: true })
        throw new Error(`sha256 mismatch: expected ${sha256}, got ${got}`)
      }
      await rename(part, file)
      return
    } catch (err) {
      if (attempt >= tries) throw new Error(`${url}: ${err.message}`)
      log(`retry ${attempt}: ${err.message}`)
      await new Promise(r => setTimeout(r, Math.min(30_000, 1000 * 2 ** attempt)))
    }
  }
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit' })
    child.on('error', reject)
    child.on('close', code => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`))))
  })
}

// One entry of a set, skipped when already in place.
export async function fetchEntry(modelsDir, entry, opts = {}) {
  const log = opts.log || (() => {})
  if (entry.to) {
    const file = path.join(modelsDir, entry.to)
    if (await exists(file) && await sha256Of(file) === entry.sha256) return log(`have ${entry.to}`)
    log(`fetch ${entry.url}`)
    return download(entry.url, entry.sha256, file, opts)
  }
  // An archive: its checked sha256 is written to .complete once extracted.
  const dir = path.join(modelsDir, entry.dir)
  const stamp = path.join(dir, '.complete')
  if ((await readFile(stamp, 'utf8').catch(() => '')).trim() === entry.sha256) return log(`have ${entry.dir}`)
  const archive = path.join(dir, path.basename(new URL(entry.url).pathname))
  log(`fetch ${entry.url}`)
  await download(entry.url, entry.sha256, archive, opts)
  const top = path.basename(archive).replace(/\.tar\.bz2$/, '')
  await run('tar', ['-xjf', archive, '-C', dir, '--strip-components=1', ...entry.members.map(m => `${top}/${m}`)])
  await rm(archive, { force: true })
  await writeFile(stamp, `${entry.sha256}\n`)
}

export function setsOf(args) {
  const names = !args.length ? DEFAULT_SETS : args.includes('all') ? Object.keys(SETS) : args
  const unknown = names.filter(n => !(n in SETS))
  if (unknown.length) throw new Error(`unknown set: ${unknown.join(', ')} (sets: ${Object.keys(SETS).join(', ')}, all)`)
  return names
}

async function main() {
  let names
  try { names = setsOf(process.argv.slice(2)) }
  catch (err) { console.error(err.message); process.exit(2) }
  const modelsDir = path.join(path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data')), 'models')
  console.log(`into ${modelsDir}`)
  for (const name of names) {
    for (const entry of SETS[name]) await fetchEntry(modelsDir, entry, { log: m => console.log(m) })
  }
  console.log('done')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err.message); process.exit(1) })
}
