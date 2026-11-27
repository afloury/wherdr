// Pure wire contract for Command Code transcript metadata records, for the
// display-only Command Code session locator. The producer lives in commandCodeFiles.ts;
// this module validates framing, counts, footer flags, stat fields and path
// shapes BEFORE decoding into the snapshot — arbitrary wire bytes can never
// become a usable candidate list. The whole stream is ONE base64 whose
// records are NUL-separated frames, so a path with spaces, newlines or
// metacharacters can never corrupt the framing.
import path from 'node:path'
import { parseStatLine } from './fsx'
import { cmdCanonicalPath, cmdSessionFile } from './commandCodeSessions'

// One transcript candidate's file metadata (the session id and header cwd
// arrive with the header unit; file and id agree by cmdSessionFile).
export interface CmdFileMeta { file: string, ino: number, size: number, mtimeMs: number }
export type CmdFilesIncomplete = 'unavailable' | 'truncated' | 'oversize' | 'raced' | 'metadata'
export interface CmdFileSnapshot {
  complete: boolean
  incomplete?: CmdFilesIncomplete
  files: CmdFileMeta[] // validated <root>/<dir>/<uuid>.jsonl only — sidecars skipped
  dirs: number // project dirs scanned
  found: number // *.jsonl files seen (>= files.length: checkpoints etc.)
}

export const CMD_FILES_MAX_TOTAL = 4 * 1024 * 1024 // parser input gate in BYTES, before splitting
const MAX_RECORDS = 8192 // file rows retained; the producer's maxf is the same bound
const MAX_LINE = 16 * 1024 // one stat line: path-free, so a generous bound
const MAX_COUNT = 1_000_000 // hard bound on footer counters — safe-but-absurd counts reject

// Wire (NUL frames, one base64 over the whole stream):
//   H                                    first
//   <absolute path>\0<stat line>\0       one stat row, in operand order. The
//                                        stat line's own type says whether it
//                                        is a project dir (skipped) or a file.
//   T\0<dirs>\0<found>\0<records>\0<flags>\0   last; records counts file rows
// Every frame must parse and the counts must agree, or the snapshot is
// truncated. Sidecar shapes (non-UUID basename inside a project dir) are
// skipped silently; they are not candidates, not errors.
export function parseCmdFiles(root: string, out: string | Buffer): CmdFileSnapshot {
  const files: CmdFileMeta[] = []
  const seen = new Set<string>()
  const fail = (r: CmdFilesIncomplete): CmdFileSnapshot => ({ complete: false, incomplete: r, files, dirs: 0, found: 0 })
  if (!cmdCanonicalPath(root)) return { complete: false, incomplete: 'metadata', files: [], dirs: 0, found: 0 }
  const bytes = Buffer.isBuffer(out) ? out : Buffer.from(out, 'latin1')
  // A string input is decoded byte-for-byte when it is pure latin1; anything
  // wider is measured in UTF-8 so a multi-byte flood still hits the gate.
  const size = Buffer.isBuffer(out) ? out.length : Buffer.byteLength(out, 'utf8')
  if (size > CMD_FILES_MAX_TOTAL) return fail('oversize')
  const frames = bytes.toString('utf8').split('\u0000')
  if (frames.at(-1) === '') frames.pop()
  if (frames[0] !== 'H') return fail('truncated')
  let dirRows = 0
  let records = 0
  let footer: { n: number, f: number, r: number, o: number } | null = null
  for (let i = 1; i < frames.length;) {
    if (frames[i] === 'T') {
      const nums = frames.slice(i + 1, i + 5).map(Number)
      if (i + 5 !== frames.length || !nums.every(n => Number.isSafeInteger(n) && n <= MAX_COUNT)) return fail('truncated')
      if (nums[3]! > 15) return fail('truncated') // only known footer bits (range first: & is int32)
      footer = { n: nums[0]!, f: nums[1]!, r: nums[2]!, o: nums[3]! }
      break
    }
    const file = frames[i]
    const line = frames[i + 1]
    if (file === undefined || line === undefined) return fail('truncated') // a cut record
    i += 2
    if (line.length > MAX_LINE) return fail('oversize')
    if (!cmdCanonicalPath(file)) return fail('truncated')
    const st = parseStatLine(line)
    if (!st || !Number.isFinite(st.mtimeMs)) return fail('truncated')
    const rel = path.relative(root, file)
    const depth = rel && rel !== '..' && !rel.startsWith('../') && !path.isAbsolute(rel) ? rel.split('/').length : -1
    // A project dir's own row: counted, never a candidate.
    if (st.isDir) {
      if (depth !== 1) return fail('truncated')
      dirRows++
      continue
    }
    if (++records > MAX_RECORDS) return fail('oversize')
    if (!st.isFile || st.ino === undefined || !Number.isSafeInteger(st.ino) || st.ino <= 0
      || !Number.isSafeInteger(st.size) || st.size < 0) {
      return fail('truncated')
    }
    const sf = cmdSessionFile(root, file)
    if (sf) {
      if (seen.has(file)) return fail('truncated') // duplicate record: wire corruption
      seen.add(file)
      files.push({ file, ino: st.ino, size: st.size, mtimeMs: st.mtimeMs })
      continue
    }
    // Only a confined <root>/<dir>/<something>.jsonl shape may be ignored as a
    // sidecar; anything the producer cannot emit is wire corruption.
    if (depth !== 2 || !file.endsWith('.jsonl')) return fail('truncated')
  }
  if (!footer) return fail('truncated') // footer must be last
  // `records` counts the file rows emitted, `found` every *.jsonl entry seen
  // and `r` the rows intended: a stat that failed mid-batch keeps its readable
  // rows and raises a flag, so a flagged snapshot may emit fewer rows than it
  // intended. Unflagged, every counter agrees exactly.
  if (records > footer.r || footer.f < footer.r || dirRows > footer.n) return fail('truncated')
  if (footer.o === 0 && (footer.r !== records || footer.f !== records || dirRows !== footer.n)) return fail('truncated')
  if (records > 0 && footer.n === 0) return fail('truncated')
  const incomplete: CmdFilesIncomplete | undefined = footer.o & 1 ? 'metadata' : footer.o & 2 ? 'raced' : footer.o & 12 ? 'oversize' : undefined
  return { complete: !incomplete, ...(incomplete ? { incomplete } : {}), files, dirs: footer.n, found: footer.f }
}
