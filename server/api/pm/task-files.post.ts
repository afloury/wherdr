// { task, paths }: where each path a task names exists on its machine, in its
// worktree or its task folder (server/utils/pmTaskFiles.ts). A path as written
// is the key; one that is no file there is absent.
import { HerdrError } from '../../utils/herdr'
import { findTaskFiles, taskSource } from '../../utils/pmTaskFiles'

export default defineApi(async (_event, body) => {
  if (!Array.isArray(body.paths)) throw new HerdrError('bad_input', 'paths: a list')
  const { m, id } = await taskSource(body.task, 'worktree')
  return { found: await findTaskFiles(m, id, body.paths) }
})
