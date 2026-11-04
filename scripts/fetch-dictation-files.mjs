#!/usr/bin/env node
// Downloads the files of on-device dictation into DATA_DIR/models, where the
// /models/** route serves them (the code: scripts/dictation-files.mjs). The
// wherdr server does the same by itself when Install finds a model missing;
// this script is for admins who fetch ahead, or on another machine.
//
//   DATA_DIR=~/.local/share/wherdr node scripts/fetch-dictation-files.mjs [set...]
//
// Sets: runtime (sherpa-onnx WASM, 13 MB), parakeet (Parakeet v3, French,
// English and 23 more, 670 MB), sensevoice (237 MB, no French), ort
// (onnxruntime-web, 59 MB, for WebGPU models only), all. Default: runtime parakeet.
import path from 'node:path'
import { SETS, fetchEntry, setsOf } from './dictation-files.mjs'

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

main().catch((err) => { console.error(err.message); process.exit(1) })
