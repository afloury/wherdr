// A machine's capacity: cores, memory, swap and load, read live through one
// POSIX script that works on Linux and macOS. Parsing is pure, so each OS's
// output has its own unit test.

// MB, except cores and the 1-minute load average. cores and load1 are 0 when unknown.
export interface MachineCapacity { cores: number, total: number, available: number, swapTotal: number, swapFree: number, load1: number }

// Linux: nproc, /proc/loadavg, /proc/meminfo. macOS: sysctl and vm_stat.
export const CAPACITY_SCRIPT = `if [ "$(uname -s)" = Darwin ]; then
  echo "cores: $(sysctl -n hw.ncpu)"
  echo "memsize: $(sysctl -n hw.memsize)"
  echo "loadavg: $(sysctl -n vm.loadavg)"
  echo "swapusage: $(sysctl -n vm.swapusage)"
  vm_stat
else
  echo "cores: $(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN)"
  echo "loadavg: $(cat /proc/loadavg)"
  cat /proc/meminfo
fi`

const field = (text: string, key: string) => new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(text)?.[1]?.trim()
const num = (s?: string) => { const n = Number.parseFloat(s ?? ''); return Number.isFinite(n) ? n : null }
const head = (text: string) => ({ cores: Math.max(0, Math.round(num(field(text, 'cores')) ?? 0)), load1: num(field(text, 'loadavg')?.replace(/^\{\s*/, '')) ?? 0 })

// Linux: /proc/meminfo in kB. null when MemTotal or MemAvailable is missing.
export function parseLinux(text: string): MachineCapacity | null {
  const mb = (k: string) => { const n = num(field(text, k)); return n === null ? null : Math.round(n / 1024) }
  const total = mb('MemTotal'), available = mb('MemAvailable')
  if (total === null || available === null) return null
  return { ...head(text), total, available, swapTotal: mb('SwapTotal') ?? 0, swapFree: mb('SwapFree') ?? 0 }
}

// macOS: available = (free + inactive + speculative + purgeable pages) × page
// size, close to Activity Monitor's figure but not exact (minFree is the margin).
// vm.swapusage: "total = 2048.00M  used = 512.25M  free = 1535.75M  (encrypted)".
export function parseMacos(text: string): MachineCapacity | null {
  const bytes = num(field(text, 'memsize'))
  const page = num(/page size of (\d+) bytes/.exec(text)?.[1])
  const pages = (k: string) => num(field(text, `Pages ${k}`)) ?? 0
  if (bytes === null || page === null || field(text, 'Pages free') === undefined) return null
  const swap = field(text, 'swapusage') ?? ''
  const swapMb = (k: string) => {
    const m = new RegExp(`${k} = ([\\d.]+)([KMG])`).exec(swap)
    return m ? Math.round(Number(m[1]) * ({ K: 1 / 1024, M: 1, G: 1024 } as const)[m[2] as 'K' | 'M' | 'G']) : 0
  }
  const available = (pages('free') + pages('inactive') + pages('speculative') + pages('purgeable')) * page
  return { ...head(text), total: Math.round(bytes / 2 ** 20), available: Math.round(available / 2 ** 20), swapTotal: swapMb('total'), swapFree: swapMb('free') }
}

// CAPACITY_SCRIPT's output, from either OS: null when it cannot be read.
export const parseCapacity = (text: string) => (/^Mach Virtual Memory/m.test(text) ? parseMacos(text) : parseLinux(text))
