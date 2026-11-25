// The rows of a task's To review block: its artifacts (reviewItems) as the links
// worth opening, most relevant first, each file only if the task's machine has
// it. Pure: the component asks the server (POST /api/pm/task-files, for
// filePaths) and draws what reviewRows returns.
import { attachmentIcon, extensionOf } from '../attachments'
import { isPrUrl, linkLabel } from './board'
import type { ReviewItem } from './reviewLinks'
import { shotsShown, shotUrl, type Shot } from './shots'
import type { ShotMode } from './workflow'

// Where the server found a file (server/utils/pmTaskFiles.ts): the task's
// worktree or its own folder, and the path under it.
export interface TaskFile { root: 'worktree' | 'task', rel: string }

export type ReviewRow =
  | { kind: 'url', key: string, url: string, label: string, host: string, icon: string }
  // at: where the file is; none while the server is still being asked.
  | { kind: 'file', key: string, path: string, label: string, source: 'step' | 'report', icon: string, at?: TaskFile }
  | { kind: 'shots', key: string, count: number, srcs: string[], icon: string }

export interface ReviewShots { task: string, shots: Shot[], mode: ShotMode }

// What the step names comes first, then its screenshots, then what the report
// and the task's links add (the worker's own pointers).
const RANK = { step: 0, report: 2, task: 3 } as const
const SHOTS_RANK = 1

const KIND: Record<string, 'image' | 'video'> = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image',
  mp4: 'video', webm: 'video', mov: 'video',
}

const baseName = (path: string) => path.split('/').at(-1)!

export function fileIcon(path: string): string {
  const kind = KIND[extensionOf(path)]
  return kind === 'video' ? 'i-lucide-video' : attachmentIcon(path, kind)
}

// A file item that is one of the shown screenshots (named by the stored file
// the upload answered with): the Screenshots row is its row.
const isShown = (path: string, shown: Shot[]) => shown.some(s => s.file.toLowerCase() === baseName(path).toLowerCase())

// The paths to ask the server about: the files the items name, without the
// screenshots the task already has.
export function filePaths(items: ReviewItem[], shots?: ReviewShots): string[] {
  const shown = shots ? shotsShown(shots.shots, shots.mode) : []
  return items.flatMap(it => (it.kind === 'file' && !isShown(it.path, shown) ? [it.path] : []))
}

const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./i, '') } catch { return '' } }

// found: what the server answered (a path as written → where it is); undefined
// while it is asked, when every candidate file shows as a row still to resolve.
export function reviewRows(i: { items: ReviewItem[], found?: Record<string, TaskFile>, shots?: ReviewShots }): ReviewRow[] {
  const shown = i.shots ? shotsShown(i.shots.shots, i.shots.mode) : []
  const ranked: { rank: number, row: ReviewRow }[] = []
  const seen = new Set<string>()
  for (const it of i.items) {
    if (it.kind === 'url') {
      // A pull request reads PR #12 whichever way the text wrote its address.
      const label = linkLabel(it)
      const host = hostOf(it.url)
      ranked.push({ rank: RANK[it.source], row: { kind: 'url', key: `url:${it.url}`, url: it.url, label, host: label.includes(host) ? '' : host, icon: isPrUrl(it.url) ? 'i-lucide-git-pull-request' : 'i-lucide-link' } })
      continue
    }
    if (isShown(it.path, shown)) continue
    const at = i.found && Object.hasOwn(i.found, it.path) ? i.found[it.path] : undefined
    if (i.found && !at) continue
    // Two written paths for one file are one row, the more relevant first.
    const key = at ? `file:${at.root}:${at.rel}` : `file:${it.path}`
    if (seen.has(key)) continue
    seen.add(key)
    ranked.push({ rank: RANK[it.source], row: { kind: 'file', key, path: it.path, label: it.label, source: it.source, icon: fileIcon(it.path), ...(at ? { at } : {}) } })
  }
  if (shown.length) ranked.push({ rank: SHOTS_RANK, row: { kind: 'shots', key: 'shots', count: shown.length, srcs: shown.map(s => shotUrl(i.shots!.task, s.file)), icon: 'i-lucide-images' } })
  const rows = ranked.sort((a, b) => a.rank - b.rank).map(r => r.row)
  // Two files with one name are told apart by the path they are at.
  const names = new Map<string, number>()
  for (const r of rows) if (r.kind === 'file') names.set(r.label, (names.get(r.label) ?? 0) + 1)
  return rows.map(r => (r.kind === 'file' && names.get(r.label)! > 1 ? { ...r, label: r.at?.rel ?? r.path } : r))
}
