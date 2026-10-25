// Links and images of a Markdown file shown in the file explorer: where a
// relative link leads, whether it stays in the browsed folder, and the anchor
// of a heading (GitHub's way), all without touching the network.

export const isMarkdownPath = (p: string) => /\.(?:md|markdown)$/i.test(p)

export type LinkTarget =
  | { kind: 'anchor', anchor: string }
  | { kind: 'external' }
  | { kind: 'outside' }
  | { kind: 'file' | 'dir', path: string, anchor: string }

const decode = (s: string) => { try { return decodeURIComponent(s) } catch { return s } }

// "a/./b/../c" -> "a/c"; null when it climbs above its start.
function normalize(parts: string[]): string[] | null {
  const out: string[] = []
  for (const p of parts) {
    if (!p || p === '.') continue
    if (p === '..') {
      if (!out.length) return null
      out.pop()
    } else out.push(p)
  }
  return out
}

// `from`: the shown file. `absolute`: its path is absolute (a file named in a
// conversation, checked against the home folder by the server); otherwise it
// is relative to the browsed folder, and a link must stay inside it: a path
// starting with "/" is then taken from that folder's top, as on GitHub.
export function resolveLink(from: string, href: string, absolute: boolean): LinkTarget | null {
  const h = href.trim()
  if (!h) return null
  if (h.startsWith('#')) return { kind: 'anchor', anchor: decode(h.slice(1)) }
  if (/^[a-z][a-z\d+.-]*:/i.test(h) || h.startsWith('//')) return { kind: 'external' }
  const hash = h.indexOf('#')
  const anchor = hash < 0 ? '' : decode(h.slice(hash + 1))
  const raw = decode((hash < 0 ? h : h.slice(0, hash)).split('?')[0]!).replace(/\\/g, '/')
  if (!raw) return null
  const dir = raw.endsWith('/')
  const kind = dir ? 'dir' : 'file'
  if (absolute) {
    if (raw.startsWith('~/')) {
      const parts = normalize(raw.slice(2).split('/'))
      return parts ? { kind, path: `~/${parts.join('/')}`, anchor } : { kind: 'outside' }
    }
    const base = raw.startsWith('/') ? [] : from.split('/').slice(0, -1)
    const parts = normalize([...base, ...raw.split('/')])
    return parts ? { kind, path: `/${parts.join('/')}`, anchor } : { kind: 'outside' }
  }
  const base = raw.startsWith('/') ? [] : from.split('/').slice(0, -1)
  const parts = normalize([...base, ...raw.split('/')])
  if (!parts) return { kind: 'outside' }
  return { kind, path: parts.join('/'), anchor }
}

// GitHub's heading anchor: lower case, punctuation dropped, spaces as "-".
export function headingSlug(text: string): string {
  return text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-')
}

// The heading an anchor points at: repeated titles get "-1", "-2"... as on GitHub.
export function findHeading(root: ParentNode, anchor: string): Element | null {
  const want = anchor.toLowerCase()
  const seen = new Map<string, number>()
  for (const h of root.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    const base = headingSlug(h.textContent || '')
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    if ((n ? `${base}-${n}` : base) === want) return h
  }
  return null
}
