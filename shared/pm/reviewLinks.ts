// A task's review artifacts, as one-click links: the URLs and the files its
// step (badge, instructions), its latest report and its links name. Pure text
// work; whether a file exists on the task's machine is the server's call.
import { linkLabel } from './board'

export type ReviewItem =
  | { kind: 'url', url: string, label: string, source: 'step' | 'report' | 'task' }
  | { kind: 'file', path: string, label: string, source: 'step' | 'report' }

const FILE_EXT = new Set(['md', 'markdown', 'txt', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'html', 'htm', 'pdf', 'json', 'csv', 'mp4', 'webm', 'mov'])
const MD_LINK = /!?\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"\n]*")?\s*\)/g
const BARE_URL = /https?:\/\/[^\s<>`"']+/gi
const TOKEN = /[^\s`'"()<>[\]{},;*|]+/g
const PATH_CHARS = /^[\p{L}\p{N}._@%+\-/]+$/u
const LABEL_MAX = 40

const count = (s: string, c: string) => s.split(c).length - 1
const OPENERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' }

// A URL found in prose, without the punctuation of the sentence around it; a
// closing bracket stays when the URL opened it (…/Foo_(bar)).
const trimUrl = (raw: string) => {
  let u = raw
  for (;;) {
    const last = u.at(-1) ?? ''
    if ('.,;:!?\'"*'.includes(last) && last) u = u.slice(0, -1)
    else if (OPENERS[last] && count(u, last) > count(u, OPENERS[last]!)) u = u.slice(0, -1)
    else return u
  }
}

const parsed = (url: string) => { try { const u = new URL(url); return /^https?:$/.test(u.protocol) && u.hostname ? u : undefined } catch { return undefined } }
const urlKey = (url: string) => { const u = parsed(url); return u ? `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}${u.search}` : undefined }

const urlLabel = (url: string) => {
  const u = parsed(url)
  if (!u) return url
  let page = u.pathname.split('/').filter(Boolean).at(-1) ?? ''
  try { page = decodeURIComponent(page) } catch { /* keep as written */ }
  const label = `${u.host.replace(/^www\./i, '')}${page ? `/${page}` : ''}`
  return label.length > LABEL_MAX ? `${label.slice(0, LABEL_MAX - 1)}…` : label
}

// A file a token names, as a clean relative-or-absolute path, or undefined.
const filePath = (token: string): string | undefined => {
  let t = token.split('#')[0]!.split('?')[0]!
  t = t.replace(/[.,;:!?]+$/, '').replace(/:\d+(?::\d+)?$/, '')
  if (!t || t.includes('://') || !PATH_CHARS.test(t)) return
  try { t = decodeURIComponent(t) } catch { /* keep as written */ }
  while (t.startsWith('./')) t = t.slice(2)
  const absolute = t.startsWith('/')
  const segs = (absolute ? t.slice(1) : t).split('/')
  if (segs.some(s => !s || s === '.' || s === '..')) return
  const name = segs.at(-1)!
  const dot = name.lastIndexOf('.')
  if (dot < 1 || !FILE_EXT.has(name.slice(dot + 1).toLowerCase())) return
  // 'example.com/page.html' is an address without its scheme, not a file.
  const head = segs[0]!
  const tld = head.includes('.') ? head.slice(head.lastIndexOf('.') + 1) : ''
  if (!absolute && segs.length > 1 && /^[a-z]{2,}$/i.test(tld) && !FILE_EXT.has(tld.toLowerCase())) return
  return t
}

const fileKey = (path: string) => path.replace(/^(?:\.\/)+/, '').replace(/\/{2,}/g, '/')

type Found =
  | { at: number, kind: 'url', url: string, label?: string }
  | { at: number, kind: 'file', path: string }

const blank = (s: string, at: number, len: number) => s.slice(0, at) + ' '.repeat(len) + s.slice(at + len)

// Every URL and file a text names, in order of appearance.
const scan = (text: string): Found[] => {
  const out: Found[] = []
  let rest = text
  for (const m of text.matchAll(MD_LINK)) {
    rest = blank(rest, m.index, m[0].length)
    const target = m[2]!
    if (/^https?:\/\//i.test(target)) {
      const url = trimUrl(target)
      if (parsed(url)) out.push({ at: m.index, kind: 'url', url, label: m[1]!.trim() })
    }
    else {
      const path = filePath(target)
      if (path) out.push({ at: m.index, kind: 'file', path })
    }
  }
  const afterLinks = rest
  for (const m of afterLinks.matchAll(BARE_URL)) {
    rest = blank(rest, m.index, m[0].length)
    const url = trimUrl(m[0])
    if (parsed(url)) out.push({ at: m.index, kind: 'url', url })
  }
  for (const m of rest.matchAll(TOKEN)) {
    const path = filePath(m[0])
    if (path) out.push({ at: m.index, kind: 'file', path })
  }
  return out.sort((a, b) => a.at - b.at)
}

export function reviewItems(i: { step?: string[], report?: string, links?: { label: string, url: string }[] }): ReviewItem[] {
  const items: ReviewItem[] = []
  const urls = new Set<string>()
  const files = new Set<string>()
  const addUrl = (url: string, label: string, source: 'step' | 'report' | 'task') => {
    const key = urlKey(url)
    if (!key || urls.has(key)) return
    urls.add(key)
    items.push({ kind: 'url', url, label, source })
  }
  const addText = (text: string, source: 'step' | 'report') => {
    for (const f of scan(text)) {
      if (f.kind === 'url') {
        addUrl(f.url, f.label && !/^https?:\/\//i.test(f.label) ? f.label : urlLabel(f.url), source)
        continue
      }
      const key = fileKey(f.path)
      if (files.has(key)) continue
      files.add(key)
      items.push({ kind: 'file', path: f.path, label: f.path.split('/').at(-1)!, source })
    }
  }
  for (const text of i.step ?? []) addText(text, 'step')
  if (i.report) addText(i.report, 'report')
  for (const l of i.links ?? []) {
    const url = trimUrl(l.url.trim())
    addUrl(url, linkLabel({ label: l.label, url }).trim() || urlLabel(url), 'task')
  }
  return items
}
