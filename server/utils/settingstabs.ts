// Active tab of an ANSI tab bar ("Settings  Status  Config  Usage  Stats"):
// the only word highlighted, either on a colored background (SGR 48;…) or
// in reverse video (SGR 7, what Claude Code draws under Herdr 0.9.3).
// eslint-disable-next-line no-control-regex
const SGR = /\x1b\[([\d;]*)m/g
// Highlight state after one SGR sequence; the arguments of extended colors
// (38/48/58;5;n and ;2;r;g;b) are skipped so that a 7 there is not reverse video.
function highlight(params: string, state: { bg: boolean, inverse: boolean }) {
  const codes = params === '' ? [0] : params.split(';').map(Number)
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i]
    if (c === 38 || c === 48 || c === 58) {
      if (c === 48) state.bg = true
      i += codes[i + 1] === 5 ? 2 : codes[i + 1] === 2 ? 4 : 0
    } else if (c === 0) { state.bg = false; state.inverse = false }
    else if (c === 7) state.inverse = true
    else if (c === 27) state.inverse = false
    else if (c === 49) state.bg = false
    else if (c >= 40 && c <= 47) state.bg = true
  }
}
export function activeTab(line: string): string | null {
  const state = { bg: false, inverse: false }
  let last = 0
  const words: { text: string, bg: boolean }[] = []
  const push = (s: string) => { for (const w of s.split(/\s+/)) if (w) words.push({ text: w, bg: state.bg || state.inverse }) }
  for (const m of line.matchAll(SGR)) {
    push(line.slice(last, m.index))
    highlight(m[1]!, state)
    last = m.index! + m[0].length
  }
  push(line.slice(last))
  const hit = words.find(w => w.bg && w.text !== 'Settings')
  return hit ? hit.text.replace(/[^\w]/g, '') : null
}
