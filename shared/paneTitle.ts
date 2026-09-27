import type { Pane } from './types'

// Les threads herdr-projects portent leur sujet dans le workspace, alors que
// le titre du terminal reprend souvent la consigne générique du premier message.
const THREAD_NAME = /^hp-.+-t-\d{4,}(?:-.+)?$/i

export function isProjectThread(p: Pick<Pane, 'name' | 'cwd'>): boolean {
  if (p.name && THREAD_NAME.test(p.name)) return true
  const cwd = p.cwd?.replace(/\\/g, '/').replace(/\/+$/, '') || ''
  if (/\/\.herdr-projects\/[^/]+$/.test(cwd)) return false
  return /\/\.herdr\/worktrees\/[^/]+\/hp-[^/]+-t-\d{4,}(?:-[^/]*)?(?:\/|$)/i.test(cwd)
    || /\/\.herdr\/worktrees\/[^/]+\/[^/]+\/\.herdr-project(?:\/|$)/.test(cwd)
    || /\/\.herdr-projects\/[^/]+\/threads\/[^/]+(?:\/|$)/.test(cwd)
    || /\/\.herdr-project\/[^/]+\/threads\/[^/]+(?:\/|$)/.test(cwd)
}

export const cleanTitle = (title: string | null | undefined) =>
  (title || '').replace(/^[^\p{L}\p{N}~/]+/u, '').trim()

export function paneTitle(p: Pane, workspaceTitle?: string | null): string {
  if (p.label) return p.label
  if (isProjectThread(p) && workspaceTitle?.trim()) return workspaceTitle.trim()
  const title = cleanTitle(p.title)
  if (!title || /^\S+@\S+:/.test(title)) return p.name || kindLabel(p.agent)
  return title.replace(/\s*\|\s*\S+$/, '')
}

function kindLabel(kind: string | null) {
  if (kind === 'claude') return 'Claude'
  if (kind === 'codex') return 'Codex'
  if (kind === 'opencode') return 'OpenCode'
  if (kind === 'gemini') return 'Gemini CLI'
  if (kind === 'kimi') return 'Kimi'
  return kind ? kind[0]!.toUpperCase() + kind.slice(1) : 'Shell'
}
