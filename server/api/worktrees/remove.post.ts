// Removes a worktree (the checkout, never the branch); `force` if
// uncommitted changes remain.
export default defineApi(async (event, b) => {
  if (typeof b.path !== 'string' || !b.path.startsWith('/')) throw new HerdrError('bad_path', 'Invalid path')
  return removeWorktree(String(b.machine || ''), b.path, b.force === true)
})
