// Project files for wherdr plugins (wherdr.files.read / write, docs/plugins.md), herdr-core only.
// A plugin reads and writes text files inside a project folder: a Git repository below the
// machine's home. Never the home itself, a hidden folder (~/.ssh, ~/.config, .git…; `.wherdr`
// is the one exception, for plugin data) or wherdr's DATA_DIR. The checks run on the real
// path on the machine (symlinks resolved), with machine.exec, on this machine or a core one.
import { posix as px } from 'node:path'
import { HerdrError } from './herdr'
import { failure } from './coreInput'
import { machineOn, type CoreAdminDeps } from './coreCreate'
import { DATA_DIR } from './env'

export const PLUGIN_FILE_MAX = 1024 * 1024 // read
export const PLUGIN_WRITE_MAX = 200 * 1024 // write (the JSON body is 256 KB at most)

// Lexical checks first: a plain absolute path, no `..`, no hidden segment but `.wherdr`.
export function pluginPathOk(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.length > 1024 || /[\0\n\r]/.test(raw)) return null
  const parts = raw.split('/').filter(Boolean)
  if (!parts.length || parts.some(s => s === '..' || s === '.' || (s.startsWith('.') && s !== '.wherdr'))) return null
  if (parts[parts.length - 1]!.startsWith('.')) return null
  return px.normalize(raw)
}

// $1 mode (read|write), $2 DATA_DIR ('' on another machine), $3 the path. Exit codes: see CODES.
export const PLUGIN_FILE_SCRIPT = `set -fu
mode=$1 data=$2 p=$3
home=$(cd "$HOME" 2>/dev/null && pwd -P) || exit 10
dir=\${p%/*} base=\${p##*/} rest=
[ -n "$dir" ] || exit 12
d=$dir
while [ ! -d "$d" ]; do rest="/\${d##*/}$rest"; d=\${d%/*}; [ -n "$d" ] || exit 12; done
real=$(cd "$d" && pwd -P)$rest
case "$real/" in "$home"/?*) ;; *) exit 12;; esac
IFS=/
for s in \${real#"$home"/}; do case $s in .wherdr) ;; .*) exit 13;; esac; done
unset IFS
if [ -n "$data" ] && dr=$(cd "$data" 2>/dev/null && pwd -P); then
  case "$real/" in "$dr"/*) exit 14;; esac
fi
g=$real proj=
while [ "$g" != "$home" ] && [ -n "$g" ]; do
  if [ -e "$g/.git" ]; then proj=$g; break; fi
  g=\${g%/*}
done
[ -n "$proj" ] || exit 15
f=$real/$base
[ ! -L "$f" ] || exit 16
if [ "$mode" = read ]; then
  [ -e "$f" ] || exit 17
  [ -f "$f" ] || exit 16
  exec head -c ${PLUGIN_FILE_MAX + 1} "$f"
fi
[ ! -e "$f" ] || [ -f "$f" ] || exit 16
mkdir -p "$real" || exit 18
tmp="$real/.$base.wherdr-$$"
if cat > "$tmp" && mv -f "$tmp" "$f"; then exit 0; fi
rm -f "$tmp"; exit 18`

const CODES: Record<number, [string, string]> = {
  12: ['bad_path', 'The file must be in a project folder under the home folder'],
  13: ['bad_path', 'Hidden folders are not allowed'],
  14: ['bad_path', 'wherdr\'s data folder is not allowed'],
  15: ['bad_path', 'Not in a project folder (a Git repository)'],
  16: ['bad_path', 'Not a regular file'],
  18: ['write_failed', 'The file could not be written'],
}

async function run(deps: CoreAdminDeps, machine: unknown, mode: 'read' | 'write', path: unknown, input?: Buffer) {
  const p = pluginPathOk(path)
  if (!p) throw new HerdrError('bad_path', 'Invalid path')
  const { m, on } = machineOn(deps, machine)
  let r: { code: number | null, stdout?: string, timed_out?: boolean, truncated?: boolean }
  try {
    r = await deps.call('machine.exec', {
      argv: ['sh', '-c', PLUGIN_FILE_SCRIPT, 'sh', mode, m.local ? DATA_DIR : '', p], ...(on ? { on } : {}), timeout: 10,
      ...(input ? { input: input.toString('base64') } : {}),
    }, 15000)
  } catch (e) { return failure(e) }
  if (r.timed_out) throw new HerdrError('timeout', 'The machine did not answer in time')
  const known = r.code !== null ? CODES[r.code] : undefined
  if (known) throw new HerdrError(known[0], known[1])
  return { code: r.code, stdout: Buffer.from(r.stdout || '', 'base64'), truncated: Boolean(r.truncated) }
}

/** Text of the file, or null when it does not exist. */
export async function pluginReadFile(deps: CoreAdminDeps, b: { machine?: unknown, path?: unknown }) {
  const r = await run(deps, b.machine, 'read', b.path)
  if (r.code === 17) return { text: null }
  if (r.code !== 0) throw new HerdrError('read_failed', 'The file could not be read')
  if (r.truncated || r.stdout.length > PLUGIN_FILE_MAX) throw new HerdrError('too_large', 'File too large (1 MB max)')
  return { text: r.stdout.toString('utf8') }
}

export async function pluginWriteFile(deps: CoreAdminDeps, b: { machine?: unknown, path?: unknown, text?: unknown }) {
  if (typeof b.text !== 'string') throw new HerdrError('bad_text', 'Text expected')
  const data = Buffer.from(b.text, 'utf8')
  if (data.length > PLUGIN_WRITE_MAX) throw new HerdrError('too_large', 'Text too large (200 KB max)')
  const r = await run(deps, b.machine, 'write', b.path, data)
  if (r.code !== 0) throw new HerdrError('write_failed', 'The file could not be written')
  return { ok: true }
}
