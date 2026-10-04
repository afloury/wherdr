import type { Pane } from './types'

// herdr-projects threads carry their topic in the workspace, while
// the terminal title often repeats the generic instruction of the first message.
const THREAD_NAME = /^hp-.+-t-\d{4,}(?:-.+)?$/i

// `hpThread`: the herdr-projects token (`hp_group …!1!<rank>!t-NNNN`) wins, for a
// thread opened as a tab in its coordinator's folder.
export function isProjectThread(p: Pick<Pane, 'name' | 'cwd'> & Partial<Pick<Pane, 'hpThread'>>): boolean {
  if (p.hpThread) return true
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

const SHELLS = new Set(['sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'tcsh', 'csh', 'nu', 'pwsh', 'login', 'tmux', 'screen'])
const GENERIC_AGENTS = new Set(['claude', 'claude code', 'codex', 'gemini', 'gemini cli', 'opencode', 'kimi', 'agent'])

const baseName = (dir: string | null | undefined) =>
  (dir || '').replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() || ''

// Title the program set and that says something: not the shell
// prompt ("user@host: ~/dir"), not the shell name, not a path nor the folder.
export function meaningfulTitle(p: Pick<Pane, 'title' | 'cwd' | 'agent'>): string {
  const title = cleanTitle(p.title).replace(/\s*\|\s*\S+$/, '').trim()
  if (!title || /^\S+@\S+:/.test(title)) return ''
  const low = title.toLocaleLowerCase()
  const first = baseName(low.split(/\s+/)[0]).replace(/^-/, '')
  if (SHELLS.has(first) && !/\s/.test(low)) return ''
  if (/^(?:~|\/)/.test(title) && !/\s/.test(title)) return ''
  const dir = baseName(p.cwd).toLocaleLowerCase()
  if (dir && (low === dir || low === `${dir}/`)) return ''
  if (p.agent && GENERIC_AGENTS.has(low)) return ''
  if (p.agent && low === p.agent.toLocaleLowerCase()) return ''
  return title
}

// Name of a pane, independent of its space's name: chosen name (pane.rename),
// agent name, terminal title if meaningful, foreground
// command, and as a last resort the folder.
export function paneTitle(p: Pane, workspaceTitle?: string | null): string {
  if (p.label) return p.label
  if (p.agent && isProjectThread(p) && workspaceTitle?.trim()) return workspaceTitle.trim()
  const shown = p.displayAgent?.trim()
  if (p.agent && shown && !GENERIC_AGENTS.has(shown.toLocaleLowerCase()) && shown.toLocaleLowerCase() !== p.agent.toLocaleLowerCase()) return shown
  const title = meaningfulTitle(p)
  if (title) return title
  if (p.agent) return p.name && p.name !== p.agent ? p.name : kindLabel(p.agent)
  if (p.command) return p.command
  return baseName(p.cwd) || (p.cwd ? '/' : 'Shell')
}

function kindLabel(kind: string | null) {
  if (kind === 'claude') return 'Claude'
  if (kind === 'codex') return 'Codex'
  if (kind === 'opencode') return 'OpenCode'
  if (kind === 'gemini') return 'Gemini CLI'
  if (kind === 'kimi') return 'Kimi'
  return kind ? kind[0]!.toUpperCase() + kind.slice(1) : 'Shell'
}
