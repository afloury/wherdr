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

const SHELLS = new Set(['sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'tcsh', 'csh', 'nu', 'pwsh', 'login', 'tmux', 'screen'])
const GENERIC_AGENTS = new Set(['claude', 'claude code', 'codex', 'gemini', 'gemini cli', 'opencode', 'kimi', 'agent'])

const baseName = (dir: string | null | undefined) =>
  (dir || '').replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() || ''

// Titre que le programme a posé et qui dit quelque chose : pas le prompt du
// shell (« user@host: ~/dir »), pas le nom du shell, pas un chemin ni le dossier.
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

// Nom d'un pane, indépendant du nom de son space : nom choisi (pane.rename),
// nom de l'agent, titre du terminal s'il est parlant, commande au premier
// plan, et en dernier recours le dossier.
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
