// Path typed or pasted in the folder browser: spaces and quotes
// removed, `~` expanded, `.`/`..` resolved, bounded under the machine's HOME.
// Returns the absolute path, or null if it leaves HOME (also checked on the server).
export function normalizeDirInput(input: string, home: string): string | null {
  let s = input.trim().replace(/^(['"])(.*)\1$/, '$2').trim()
  const root = home.replace(/\/+$/, '') || '/'
  if (!s || s === '~') return root
  s = s.replace(/^~(?=\/)/, root)
  if (!s.startsWith('/')) s = `${root}/${s}`
  const parts: string[] = []
  for (const seg of s.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  const abs = '/' + parts.join('/')
  return abs === root || abs.startsWith(root === '/' ? '/' : root + '/') ? abs : null
}
