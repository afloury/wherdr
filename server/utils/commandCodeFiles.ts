// Bounded Command Code transcript metadata discovery, for the display-only
// Command Code session locator. One bounded script round trip through
// ShellExec (machine.exec through herdr-core, on the pane's machine or this one) lists
// every root/<one project dir>/<UUID>.jsonl with its file stat. No find, no
// per-file RPC and no per-file fork: the script walks the two fixed levels
// with builtins only and runs ONE `stat` per project directory over that
// directory and all of its *.jsonl entries, NUL-framing the whole stream and
// encoding it with a single `base64`. Unreadable dirs and vanished files are
// still reported, never silently dropped. The record contract and snapshot
// parser live in commandCodeFileRecords.ts. A missing root is a COMPLETE
// empty snapshot; any unreadable/raced/capped evidence is INCOMPLETE, never
// a partial usable list.
import { createHash } from 'node:crypto'
import type { ShellExec } from './fsx'
import { cmdCanonicalPath, cmdProjectsRoot } from './commandCodeSessions'
import { CMD_FILES_MAX_TOTAL, type CmdFileSnapshot, parseCmdFiles } from './commandCodeFileRecords'

// Producer stdout is bounded BEFORE machine.exec serializes its reply: the
// accumulated decoded budget stops at ~2 MiB, under the parser's 4 MiB gate
// and SIX TIMES below core's 16 MiB reply limit once base64 inflates it.
// Footer flags: 1 unreadable (root/dir/file/stat), 2 raced (listed entry
// vanished before its test), 4 overflow, 8 dir/file cap exhaustion. `T`
// carries dirs/files-found/records/flags; counts must agree with the emitted
// records, and every counted entry — symlinked, vanished, unreadable — spends
// from the same maxd/maxf budget before it is flagged and skipped.
// $1: projects root, $2: max project dirs, $3: max *.jsonl file entries.
export const CMD_FILES_SCRIPT = `P=$1
maxd=\${2:-4096}
maxf=\${3:-8192}
CAP=2000000
LC_ALL=C; export LC_ALL
m=%.9Y; stat -c "$m" / 2>/dev/null | grep -q '^[0-9]*[.][0-9]' || m=%Y
ST="%n\\000%s $m %i %F\\000"
# One scratch file for a directory's stat output (NUL-safe, unlike a shell
# variable); removed on exit, best effort.
tmp=\${TMPDIR:-/tmp}/cmd-files.$$.\${RANDOM:-0}
trap 'rm -f "$tmp"' EXIT
if printf x | base64 -w0 >/dev/null 2>&1; then b64() { base64 -w0; }; else b64() { base64 | tr -d '\\n'; }; fi
{
  n=0; f=0; r=0; o=0; ob=0
  printf 'H\\000'
  footer() { printf 'T\\000%s\\000%s\\000%s\\000%s\\000' "$n" "$f" "$r" "$o"; }
  nd() { n=$((n+1)); [ "$n" -le "$maxd" ]; }
  cf() { f=$((f+1)); [ "$f" -le "$maxf" ]; }
  # Missing root is a complete empty snapshot; anything else about the root
  # itself (symlink incl. dangling, non-dir, unreadable) is incomplete
  # evidence, never usable. The -L test must precede -e: a dangling link fails
  # -e and would otherwise fake an absent root.
  if [ -L "$P" ]; then o=1; footer; exit 0; fi
  if [ ! -e "$P" ]; then footer; exit 0; fi
  if [ ! -d "$P" ] || [ ! -r "$P" ] || [ ! -x "$P" ]; then o=1; footer; exit 0; fi
  for d in "$P"/* "$P"/.[!.]* "$P"/..?*; do
    # A literal glob pattern is "unmatched" only when its path is also absent
    # and not a symlink: a real entry named '*', '.[!.]*' or '..?*' expands to
    # the same string and must scan like any other metacharacter name.
    if { [ "$d" = "$P"'/*' ] || [ "$d" = "$P"'/.[!.]*' ] || [ "$d" = "$P"'/..?*' ]; } && [ ! -e "$d" ] && [ ! -L "$d" ]; then continue; fi
    if [ -L "$d" ]; then o=$((o|1)); nd || { o=$((o|8)); break; }; continue; fi  # symlink dir: incomplete, never followed
    if [ ! -e "$d" ]; then o=$((o|2)); nd || { o=$((o|8)); break; }; continue; fi # listed, then vanished: raced
    [ -d "$d" ] || continue                                                     # a plain file is not a project dir
    nd || { o=$((o|8)); break; }
    [ -r "$d" ] && [ -x "$d" ] || { o=$((o|1)); continue; }
    set --
    cnt=0
    for g in "$d"/*.jsonl; do
      [ "$g" = "$d"'/*.jsonl' ] && [ ! -e "$g" ] && [ ! -L "$g" ] && continue    # unmatched glob literal
      if [ -L "$g" ]; then o=$((o|1)); cf || { o=$((o|8)); break 2; }; continue; fi  # symlink file: incomplete, never followed
      if [ ! -e "$g" ]; then o=$((o|2)); cf || { o=$((o|8)); break 2; }; continue; fi # listed, then vanished: raced
      [ -f "$g" ] || continue                                                     # posing directory: not a file entry
      if [ ! -r "$g" ]; then o=$((o|1)); cf || { o=$((o|8)); break 2; }; continue; fi # unreadable candidate: incomplete
      cf || { o=$((o|8)); break 2; }
      set -- "$@" "$g"; cnt=$((cnt+1))
    done
    # Worst-case decoded size of this directory's rows: its own row plus one
    # per accepted file, each a path plus a bounded stat line. Stop before
    # emitting when the accumulated budget would pass CAP.
    cost=$((\${#d} + 40))
    for g in "$@"; do cost=$((cost + \${#g} + 40)); done
    [ $((ob + cost)) -ge "$CAP" ] && { o=$((o|4)); break; }
    ob=$((ob + cost))
    # A vanished operand is found with builtins only, before any fork: it
    # becomes raced (flag 2) and never reaches stat, so the batch below is a
    # single clean call. Every original operand is examined exactly once.
    files=$#
    i=0
    while [ "$i" -lt "$files" ]; do
      if [ -e "$1" ]; then set -- "$@" "$1"; else o=$((o|2)); cnt=$((cnt-1)); fi
      shift; i=$((i+1))
    done
    # ONE stat per directory lists the directory and every surviving file in
    # it — one fork per directory, never one per file. Its output goes to a
    # temp FILE, never a shell variable (command substitution drops the NUL
    # bytes the wire relies on): on success it is emitted whole. A failed
    # operand (unreadable) discards that partial output, and each path is
    # stat'ed alone (a fork per path, on the anomaly only) so only what really
    # failed is flagged and no readable row is lost.
    if stat --printf="$ST" "$d" "$@" > "$tmp" 2>/dev/null; then
      cat "$tmp"
    else
      for g in "$d" "$@"; do
        if stat --printf="$ST" "$g" 2>/dev/null; then continue; fi
        if [ "$g" = "$d" ]; then o=$((o|1))
        elif [ -e "$g" ]; then o=$((o|1)); else o=$((o|2)); fi
      done
    fi
    r=$((r + cnt))
  done
  footer
} | b64`

// A COMPLETE snapshot is immutable and content-addressed: an unchanged second
// window decodes to the same object, so the header pass's in-flight
// coalescing keys stay stable and its cache hits without re-reading headers.
// Incomplete snapshots are never cached: a raced or unreadable listing must
// be observed again, not replayed. Keyed by the exec (one per machine) and
// bounded per machine.
const CACHE_MAX = 4
const snapshots = new WeakMap<ShellExec, Map<string, { key: string, snap: CmdFileSnapshot }>>()

// One bounded round trip. A failed exec reports unavailable; a non-canonical
// root is rejected before the script ever runs.
export async function cmdFiles(exec: ShellExec, home: string, opts: { root?: string, timeoutMs?: number, maxDirs?: number, maxFiles?: number } = {}): Promise<CmdFileSnapshot> {
  const root = opts.root || cmdProjectsRoot(home)
  if (!cmdCanonicalPath(root)) return { complete: false, incomplete: 'metadata', files: [], dirs: 0, found: 0 }
  const args = [root, String(opts.maxDirs ?? 4096), String(opts.maxFiles ?? 8192)]
  const r = await exec(CMD_FILES_SCRIPT, args, { timeoutMs: opts.timeoutMs ?? 10000, maxBytes: Math.ceil(CMD_FILES_MAX_TOTAL / 3) * 4 + 4096 })
  if (r.code !== 0) return { complete: false, incomplete: 'unavailable', files: [], dirs: 0, found: 0 }
  const raw = Buffer.from(r.stdout.toString('latin1'), 'base64')
  const snap = parseCmdFiles(root, raw)
  if (!snap.complete) return snap
  const key = createHash('sha256').update(raw).digest('hex')
  let byRoot = snapshots.get(exec)
  if (!byRoot) { byRoot = new Map(); snapshots.set(exec, byRoot) }
  const hit = byRoot.get(root)
  if (hit?.key === key) return hit.snap
  byRoot.delete(root)
  byRoot.set(root, { key, snap })
  if (byRoot.size > CACHE_MAX) byRoot.delete(byRoot.keys().next().value!)
  return snap
}
