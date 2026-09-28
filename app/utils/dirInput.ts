// Chemin tapé ou collé dans le navigateur de dossiers : espaces et guillemets
// retirés, `~` développé, `.`/`..` résolus, borné sous le HOME de la machine.
// Renvoie le chemin absolu, ou null s'il sort du HOME (vérifié aussi côté serveur).
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
