// Bounded Command Code process census on one machine, for the display-only
// Command Code session locator. One Linux /proc scan per call (a single
// bounded script round trip through ShellExec: machine.exec on a remote core
// host or locally on the core host). A single awk pass selects only
// candidate PIDs with zero per-PID forks, then full process metadata and
// resolved file arguments are collected only for selected candidates;
// classification lives solely in agentCensus.ts.
import type { ShellExec } from './fsx'
import { parseAgentCensus, type AgentCensus } from './agentCensus'

const MAX_CMDLINE = 16384
// Producer stdout is bounded BEFORE machine.exec serializes its reply: emit()
// stops at ~3 MiB, under the ShellExec maxBytes and the parser's 4 MiB gate
// (both far below core's 16 MiB reply limit). An overflow sets footer bit 4.
// $1: proc root (tests inject a synthetic one), $2: max pid dirs, $3: max records.
// `res` is base64 of <arg>\x01<resolved>\x01 pairs for candidate file/preload
// arguments on interpreter candidates. `R pid` marks a record dropped by a
// mid-read generation change; `T` carries scanned/emitted/overflow/unknown counts.
export const AGENT_CENSUS_SCRIPT = `P=$1
maxd=\${2:-8192}
maxr=\${3:-256}
CAP=3000000
hz=$(getconf CLK_TCK 2>/dev/null); [ -n "$hz" ] || hz=-
boot=$(awk '$1 == "btime" { print $2 }' "$P/stat" 2>/dev/null); [ -n "$boot" ] || boot=-
if [ -d "$P" ] && [ -r "$P/uptime" ]; then ok=1; else ok=0; fi
printf 'H %s %s %s\\n' "$hz" "$boot" "$ok"
if [ "$ok" != 1 ]; then printf 'T 0 0 0 0\\n'; exit 0; fi
n=0; r=0; rr=0; o=0; u=0; ob=0
i1=$(printf '\\001')
if printf x | base64 -w0 >/dev/null 2>&1; then b64() { base64 -w0; }; else b64() { base64 | tr -d '\\n'; }; fi
emit() { l=\${#1}; [ $((ob + l)) -ge $CAP ] && { o=$((o|4)); return 1; }; ob=$((ob+l+1)); printf '%s\\n' "$1"; }
rslv() { case $1 in /*) [ -e "$1" ] && readlink -f "$1" 2>/dev/null ;; *) [ -e "$d/cwd/$1" ] && readlink -f "$d/cwd/$1" 2>/dev/null ;; esac }

# Pass 1: single awk invocation scans all /proc/<pid>/{comm,cmdline,stat}
# without per-PID forks, emitting only candidate PIDs and unreadable hints.
pass1=$(printf '%s\\n' "$P"/[0-9]* | awk -v maxd="$maxd" '
{
  d = $0
  cf = d "/comm"; cm = ""
  if ((rc = (getline cm < cf)) >= 0) close(cf)
  af = d "/cmdline"; ag = ""
  if ((ra = (getline ag < af)) >= 0) {
    while ((ra2 = (getline l < af)) > 0) ag = ag "\\n" l
    close(af)
  }
  st = ""
  if (cm == "" && ag == "") {
    sf = d "/stat"
    if ((rs = (getline st < sf)) >= 0) {
      while ((rs2 = (getline l < sf)) > 0) st = st "\\n" l
      close(sf)
    }
    if (st == "") { print "? " d; next }
  }
  n++
  if (n > maxd) { ov = 1; next }
  if (ag == "") {
    if (st == "") {
      sf = d "/stat"
      if ((rs = (getline st < sf)) >= 0) {
        while ((rs2 = (getline l < sf)) > 0) st = st "\\n" l
        close(sf)
      }
    }
    t = st; sub(/.*\\) /, "", t)
    if (substr(t, 1, 1) ~ /^[ZXx]$/) next
    if (cm == "" || cm ~ /^(node|nodejs|bun|deno|command-code|command_code|commandcode)/ || cm == "cmd" || cm == "cmd.exe" || cm == "cmdc") {
      print "C " d
    }
    next
  }
  if (cm ~ /^(command-code|command_code|commandcode|cmdc)$/ || cm ~ /^(node|nodejs|bun|bunx|deno)[0-9]*$/) {
    print "C " d; next
  }
  a0 = ag; sub(/\\000.*/, "", a0); a0b = a0; sub(/.*\\//, "", a0b)
  if (a0b ~ /^(cmd|cmdc|command-code|commandcode|command_code)$/ || a0b ~ /^(node|nodejs|bun|bunx|deno)/) {
    print "C " d; next
  }
}
END { printf "M %d %d\\n", n + 0, ov + 0 }
')

exe_hits=$(ls -l "$P"/[0-9]*/exe 2>/dev/null | awk -F/ '/command-code/ { for (i=1; i<=NF; i++) if ($i ~ /^[0-9]+$/ && $(i+1) ~ /^exe /) { print $i; break } }')

cands=""
nl="
"
oifs=$IFS; IFS=$nl
for line in $pass1; do
  case $line in
    "M "*) rest=\${line#M }; n=\${rest%% *}; ov=\${rest#* }; [ "$ov" = 1 ] && o=$((o|1)) ;;
    "? "*) d=\${line#"? "}; if [ -e "$d/stat" ]; then n=$((n+1)); [ "$n" -le "$maxd" ] && u=$((u+1)) || o=$((o|1)); fi ;;
    "C "*) cands="$cands\${cands:+$nl}\${line#C }" ;;
  esac
done
IFS=$oifs

for pid in $exe_hits; do
  case "$nl$cands$nl" in
    *"$nl$P/$pid$nl"*) ;;
    *) [ -e "$P/$pid/stat" ] && cands="$cands\${cands:+$nl}$P/$pid" ;;
  esac
done

oifs=$IFS; IFS=$nl
for d in $cands; do
  IFS=$oifs
  [ -e "$d/stat" ] || continue
  pid=\${d##*/}
  [ $((r + rr)) -lt "$maxr" ] || { o=$((o|2)); continue; }
  IFS= read -r st1 < "$d/stat" 2>/dev/null || st1=""
  st1=\${st1##*) }
  IFS= read -r comm < "$d/comm" 2>/dev/null || comm=""
  args=$(head -c ${MAX_CMDLINE + 1} "$d/cmdline" 2>/dev/null | tr '\\000' '\\001')
  a0=\${args%%$i1*}
  a0b=\${a0##*/}
  res=
  iname=
  case $comm in node|nodejs|node[0-9]*|bun|bunx|bun[0-9]*|deno|deno[0-9]*) iname=$comm ;; esac
  [ -n "$iname" ] || case $a0b in node*|nodejs*|bun*|bunx*|deno*) iname=$a0b ;; esac
  case $iname in
    node*)
      rest=
      case $args in *"$i1"*) rest=\${args#*$i1} ;; esac
      case $args in *"$i1") rest=\${rest%$i1} ;; esac
      if [ -n "$rest" ]; then
        oifs2=$IFS; IFS=$i1; set -f; set -- $rest; set +f; IFS=$oifs2
        want=0; pos=0; dd=0
        for arg in "$@"; do
          [ \${#res} -ge 2048 ] && break
          if [ "$dd" = 1 ]; then
            vr=$(rslv "$arg"); res="$res$(printf '%s\\001%s\\001' "$arg" "$vr")"; break
          fi
          if [ "$want" = 1 ]; then
            want=0
            [ -n "$arg" ] && { vr=$(rslv "$arg"); res="$res$(printf '%s\\001%s\\001' "$arg" "$vr")"; }
            continue
          fi
          case $arg in
            --) dd=1 ;;
            -r|--require|--import|--experimental-loader) want=1 ;;
            --require=*|--import=*|--experimental-loader=*)
              v=\${arg#*=}
              [ -n "$v" ] && { vr=$(rslv "$v"); res="$res$(printf '%s\\001%s\\001' "$v" "$vr")"; } ;;
            -*) ;;
            *)
              if [ -n "$arg" ] && [ "$pos" -lt 16 ]; then
                pos=$((pos+1))
                vr=$(rslv "$arg")
                res="$res$(printf '%s\\001%s\\001' "$arg" "$vr")"
              fi ;;
          esac
        done
      fi ;;
  esac
  read -r up _ < "$P/uptime" 2>/dev/null; [ -n "$up" ] || up=-
  argvb=$(head -c ${MAX_CMDLINE + 1} "$d/cmdline" 2>/dev/null | b64)
  cwdb=$(readlink "$d/cwd" 2>/dev/null | b64)
  exeb=$(readlink "$d/exe" 2>/dev/null | b64)
  if [ -n "$res" ]; then resb=$(printf %s "$res" | b64); else resb=""; fi
  if [ -n "$comm" ]; then commb=$(printf %s "$comm" | b64); else commb=""; fi
  IFS= read -r st2 < "$d/stat" 2>/dev/null || st2=""
  st2=\${st2##*) }
  set -f; set -- $st1; pp=\${2:--}; t1=\${20:--}
  set -- $st2; t2=\${20:-}; set +f
  # The wall stamp must follow every byte the parser may classify on: only
  # then is it a machine-time witness that this record's shape existed — a
  # fork->exec flip can never mint an earlier cmd bound. Uptime stays first
  # so the birth upper bound keeps its before-wall ordering.
  wall=$(date +%s.%N 2>/dev/null); [ -n "$wall" ] || wall=-
  if [ "$t1" != "$t2" ]; then emit "R $pid" && rr=$((rr+1)) || break
  else emit "S $pid $pp $t1 $up $wall $commb $argvb $cwdb $exeb $resb" && r=$((r+1)) || break
  fi
  IFS=$nl
done
IFS=$oifs
printf 'T %s %s %s %s\\n' "$n" "$r" "$o" "$u"`

// One bounded round trip. Non-Linux or a missing /proc => ok=0 => unavailable;
// a failed exec reports the same, never a usable empty census.
export async function agentCensus(exec: ShellExec, opts: { procRoot?: string, timeoutMs?: number } = {}): Promise<AgentCensus> {
  const r = await exec(AGENT_CENSUS_SCRIPT, [opts.procRoot || '/proc'], { timeoutMs: opts.timeoutMs ?? 10000, maxBytes: 3 * 1024 * 1024 })
  if (r.code !== 0) return { complete: false, incomplete: 'unavailable', processes: [], uncertain: [], scanned: 0, unknown: 0 }
  return parseAgentCensus(r.stdout.toString('utf8'))
}
