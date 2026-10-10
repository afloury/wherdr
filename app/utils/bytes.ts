// File size: 812 B, 4.2 kB, 1.3 MB. A value that rounds to 1000 moves to the next unit.
export function fmtBytes(n: number) {
  if (n < 1000) return `${n} B`
  const units = ['kB', 'MB', 'GB', 'TB']
  let v = n / 1000
  let i = 0
  for (;;) {
    const s = v.toFixed(v < 10 ? 1 : 0)
    if (Number(s) < 1000 || i === units.length - 1) return `${s} ${units[i]}`
    v /= 1000; i++
  }
}
