// Active tab of an ANSI tab bar ("Settings  Status  Config  Usage  Stats"):
// the only word written on a colored background (SGR 48;…).
// eslint-disable-next-line no-control-regex
const SGR = /\x1b\[([\d;]*)m/g
export function activeTab(line: string): string | null {
  let bg = false
  let last = 0
  const words: { text: string, bg: boolean }[] = []
  const push = (s: string) => { for (const w of s.split(/\s+/)) if (w) words.push({ text: w, bg }) }
  for (const m of line.matchAll(SGR)) {
    push(line.slice(last, m.index))
    const codes = m[1]!.split(';')
    if (m[1] === '' || codes.includes('0')) bg = false
    if (codes.includes('48')) bg = true
    if (codes.includes('49')) bg = false
    last = m.index! + m[0].length
  }
  push(line.slice(last))
  const hit = words.find(w => w.bg && w.text !== 'Settings')
  return hit ? hit.text.replace(/[^\w]/g, '') : null
}
