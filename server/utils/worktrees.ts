// Worktrees Git des agents (créés par Herdr, souvent depuis « Nouveau » avec
// « worktree séparé ») : liste et suppression, pour ne pas les laisser
// s'accumuler. Herdr ne liste les worktrees que dépôt par dépôt : on
// interroge les dépôts des panes ouverts et des dossiers récents de chaque
// machine. `worktree.remove` ne vise qu'un worktree ouvert en workspace : un
// worktree fermé est d'abord rouvert (sans focus). La branche est gardée.
import type { WorktreeInfo } from '../../shared/types'
import { joinId, splitId } from '../../shared/ids'
import { HerdrError, herdrOn } from './herdr'
import { type Machine, allMachines, getMachine } from './machines'
import { recentDirs } from './actions'
import { getState, poll } from './state'

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const opts = { trust_repository: true }

async function machineWorktrees(m: Machine): Promise<WorktreeInfo[]> {
  const st = getState()
  const mine = st.panes.filter(p => splitId(p.id).machine === m.key)
  const cwds = [...new Set([...mine.map(p => p.cwd), ...(await recentDirs(m))].filter((c): c is string => Boolean(c && c.startsWith('/'))))]
  const repos = new Set<string>()
  const out: WorktreeInfo[] = []
  for (const cwd of cwds.slice(0, 30)) {
    let r: Json
    try { r = await herdrOn(m.key, 'worktree.list', { cwd, ...opts }, 8000) }
    catch { continue } // pas un dépôt Git, ou dossier disparu
    const src = r.source || {}
    const key = String(src.repo_key || src.repo_root || cwd)
    if (repos.has(key)) continue
    repos.add(key)
    for (const w of r.worktrees || []) {
      if (!w.is_linked_worktree || w.is_bare) continue
      const ws = w.open_workspace_id ? joinId(m.key, String(w.open_workspace_id)) : null
      const panes = ws ? mine.filter(p => p.workspace === ws) : []
      out.push({
        machine: m.key,
        repo: String(src.repo_name || ''),
        repoRoot: String(src.repo_root || ''),
        path: String(w.path),
        branch: w.is_detached ? null : (w.branch ? String(w.branch) : null),
        workspace: ws,
        agents: panes.filter(p => p.agent).length,
        panes: panes.length,
        prunable: Boolean(w.is_prunable),
      })
    }
  }
  return out
}

export async function listWorktrees(): Promise<WorktreeInfo[]> {
  const all: WorktreeInfo[] = []
  for (const m of allMachines()) {
    if (m.info().baseKey) continue
    if (!m.local && m.status !== 'online') continue
    all.push(...await machineWorktrees(m).catch(() => []))
  }
  return all.sort((a, b) => a.repo.localeCompare(b.repo) || String(a.branch).localeCompare(String(b.branch)))
}

// Supprime le checkout `path` (jamais la branche). Refus de Git s'il reste des
// modifications : code `dirty`, à redemander avec `force`.
export async function removeWorktree(machine: string, path: string, force: boolean) {
  const m = getMachine(machine)
  if (!m || (!m.local && m.status !== 'online')) throw new HerdrError('unreachable', 'machine injoignable')
  const wt = (await machineWorktrees(m)).find(w => w.path === path)
  if (!wt) throw new HerdrError('not_found', 'worktree introuvable')
  let ws = wt.workspace ? splitId(wt.workspace).local : null
  let reopened = false
  if (!ws) {
    const o = await herdrOn(m.key, 'worktree.open', { cwd: wt.repoRoot, path, focus: false, ...opts }, 20000)
    ws = String(o.workspace.workspace_id)
    reopened = true
  }
  try {
    await herdrOn(m.key, 'worktree.remove', { workspace_id: ws, force, ...opts }, 30000)
  } catch (e) {
    // Rouvert seulement pour le supprimer : on le referme.
    if (reopened) await herdrOn(m.key, 'workspace.close', { workspace_id: ws }).catch(() => {})
    if ((e as HerdrError).code === 'dirty_worktree_requires_force') throw new HerdrError('dirty', 'modifications non commitées dans ce worktree')
    throw e
  }
  poll()
  return { ok: true }
}
