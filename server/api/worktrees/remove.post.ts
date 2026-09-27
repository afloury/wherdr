// Supprime un worktree (le checkout, jamais la branche) ; `force` s'il reste
// des modifications non commitées.
export default defineApi(async (event, b) => {
  if (typeof b.path !== 'string' || !b.path.startsWith('/')) throw new HerdrError('bad_path', 'chemin invalide')
  return removeWorktree(String(b.machine || ''), b.path, b.force === true)
})
